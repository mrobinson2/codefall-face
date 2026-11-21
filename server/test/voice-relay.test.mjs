import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { createVoiceRelay, voiceLiveUrl } from '../lib/voice-relay.mjs';

const endpoint = 'https://test-resource.services.ai.azure.com';
const key = 'mock-azure-key';

async function startServer(t, server) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function startRelay(t, config) {
  const relay = createVoiceRelay(config);
  const server = http.createServer(relay.handleHealth);
  server.on('upgrade', relay.handleUpgrade);
  return startServer(t, server);
}

function deniedUpgrade(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url.replace('http:', 'ws:'), { headers });
    client.on('error', reject);
    client.on('open', () => {
      client.terminate();
      reject(new Error('Unexpected relay connection'));
    });
    client.on('unexpected-response', (_, response) => {
      response.resume();
      client.terminate();
      resolve(response.statusCode);
    });
  });
}

test('voice URL uses the stable API, keeps configuration overrides, and never includes the key', () => {
  assert.equal(voiceLiveUrl(endpoint).toString(), 'wss://test-resource.services.ai.azure.com/voice-live/realtime?api-version=2026-04-10&model=gpt-realtime');
  assert.equal(voiceLiveUrl(endpoint, 'my model', '2025-10-01').searchParams.get('model'), 'my model');
  assert.equal(voiceLiveUrl(endpoint, 'my model', '2025-10-01').searchParams.get('api-version'), '2025-10-01');
  assert.equal(voiceLiveUrl('https://user:secret@test-resource.services.ai.azure.com'), null);
  assert.equal(voiceLiveUrl('http://test-resource.services.ai.azure.com'), null);
});

test('unconfigured relay reports unavailable and refuses connections', async t => {
  const origin = await startRelay(t, {});
  const health = await fetch(origin + '/api/voice/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { available: false });
  assert.equal(await deniedUpgrade(origin + '/relay', { Origin: origin }), 503);
});

test('public proxy token is required and an unlisted browser origin cannot connect', async t => {
  const publicOrigin = 'https://game.example.test';
  const origin = await startRelay(t, { endpoint, key, token: 'proxy-test-token', allowedOrigins: [publicOrigin] });
  const health = await fetch(origin + '/api/voice/health', {
    headers: { Origin: publicOrigin, Authorization: 'Bearer proxy-test-token' },
  });
  assert.deepEqual(await health.json(), { available: true });
  assert.equal(await deniedUpgrade(origin + '/relay', { Origin: publicOrigin }), 401);
  assert.equal(await deniedUpgrade(origin + '/relay', { Origin: origin }), 401);
  assert.equal(await deniedUpgrade(origin + '/relay', {
    Origin: 'https://other.example.test', Authorization: 'Bearer proxy-test-token',
  }), 403);
});

test('relay queues the initial update and forwards Voice Live audio as text', async t => {
  const service = http.createServer();
  const upstreamSockets = new WebSocketServer({ noServer: true });
  const upstreamUrl = (await startServer(t, service)).replace('http:', 'ws:');
  const pending = once(service, 'upgrade');
  const origin = await startRelay(t, {
    endpoint, key,
    dial(url, options) {
      assert.equal(url.searchParams.get('api-version'), '2026-04-10');
      return new WebSocket(upstreamUrl + url.pathname + url.search, options);
    },
  });
  const client = new WebSocket(origin.replace('http:', 'ws:') + '/relay', { origin });
  await once(client, 'open');
  client.send(JSON.stringify({ type: 'session.update' }));
  const [req, socket, head] = await pending;
  assert.equal(req.headers['api-key'], key);
  assert.doesNotMatch(req.url, /mock-azure-key/);
  const browserReply = once(client, 'message');
  upstreamSockets.handleUpgrade(req, socket, head, upstream => {
    upstream.once('message', (data, binary) => {
      assert.equal(binary, false);
      assert.deepEqual(JSON.parse(data.toString()), { type: 'session.update' });
      upstream.send(JSON.stringify({ type: 'response.audio.delta', delta: 'AA==' }));
    });
  });
  const [response, binary] = await browserReply;
  assert.equal(binary, false);
  assert.deepEqual(JSON.parse(response.toString()), { type: 'response.audio.delta', delta: 'AA==' });
  client.close();
  await once(client, 'close');
});

test('unavailable upstream cannot accumulate an unbounded handshake queue', async t => {
  const service = http.createServer();
  service.on('upgrade', () => { /* Intentionally hold the upstream handshake open. */ });
  const upstreamUrl = (await startServer(t, service)).replace('http:', 'ws:');
  const origin = await startRelay(t, {
    endpoint, key,
    dial: (_, options) => new WebSocket(upstreamUrl, options),
  });
  const client = new WebSocket(origin.replace('http:', 'ws:') + '/relay', { origin });
  await once(client, 'open');
  const closed = once(client, 'close');
  for (let index = 0; index < 64; index++) client.send('{"type":"input_audio_buffer.append"}');
  assert.equal((await closed)[0], 1013);
});
