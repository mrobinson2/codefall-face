import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createTools, runStdioServer } from '../integrations/mcp/codefall-face-mcp.mjs';

function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const route of routes) {
      if (String(url).includes(route.match)) {
        if (route.fail) throw new Error(route.fail);
        return {
          ok: route.status ? route.status < 400 : true,
          status: route.status || 200,
          async json() { return typeof route.body === 'function' ? route.body({ url, init }) : route.body; },
        };
      }
    }
    throw new Error(`unmatched url ${url}`);
  };
  impl.calls = calls;
  return impl;
}

function toolText(result) {
  return result.content.map((c) => c.text).join('\n');
}

test('tool definitions cover the visual TTS/STT surface with schemas', () => {
  const tools = createTools({ fetchImpl: stubFetch([]) });
  const names = tools.list().map((t) => t.name);
  assert.deepEqual(
    names.sort(),
    ['face_ask', 'face_emotion', 'face_listen', 'face_set', 'face_speak', 'face_status'].sort(),
  );
  for (const tool of tools.list()) {
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('face_speak posts to /api/face/say with bearer token and reports delivery', async () => {
  const fetchImpl = stubFetch([{ match: '/api/face/say', body: { delivered: 2 } }]);
  const tools = createTools({ baseUrl: 'http://face.test', token: 'tok', fetchImpl });
  const result = await tools.call('face_speak', { text: 'build passed', emotion: 'joy' });
  assert.notEqual(result.isError, true);
  assert.match(toolText(result), /2/);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'http://face.test/api/face/say');
  assert.equal(call.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(call.init.body), { text: 'build passed', emotion: 'joy' });
});

test('face_speak with zero connected faces is a tool error with guidance', async () => {
  const fetchImpl = stubFetch([{ match: '/api/face/say', body: { delivered: 0 } }]);
  const tools = createTools({ fetchImpl });
  const result = await tools.call('face_speak', { text: 'anyone there' });
  assert.equal(result.isError, true);
  assert.match(toolText(result), /no face/i);
});

test('an unreachable face server surfaces an actionable tool error, not a crash', async () => {
  const fetchImpl = stubFetch([{ match: '/api/face/say', fail: 'fetch failed: ECONNREFUSED' }]);
  const tools = createTools({ baseUrl: 'http://localhost:9999', fetchImpl });
  const result = await tools.call('face_speak', { text: 'hello' });
  assert.equal(result.isError, true);
  assert.match(toolText(result), /localhost:9999/);
});

test('face_set issues one validated command per provided field', async () => {
  const fetchImpl = stubFetch([{ match: '/api/face/command', body: { delivered: 1 } }]);
  const tools = createTools({ fetchImpl });
  const result = await tools.call('face_set', { theme: 'codefall', quality: 'high', visualIntensity: 0.4 });
  assert.notEqual(result.isError, true);
  const sent = fetchImpl.calls.map((c) => JSON.parse(c.init.body));
  assert.deepEqual(sent, [
    { type: 'theme', theme: 'codefall' },
    { type: 'quality', quality: 'high' },
    { type: 'visual-intensity', value: 0.4 },
  ]);
});

test('face_set with no fields is a tool error', async () => {
  const tools = createTools({ fetchImpl: stubFetch([]) });
  const result = await tools.call('face_set', {});
  assert.equal(result.isError, true);
});

test('face_listen turns the mic on, long-polls, turns it off, and returns the transcript', async () => {
  const fetchImpl = stubFetch([
    { match: '/api/face/command', body: { delivered: 1 } },
    { match: '/api/face/listen', body: { event: { text: 'run the tests', role: 'user' }, lastSeq: 7 } },
  ]);
  const tools = createTools({ fetchImpl });
  const result = await tools.call('face_listen', { timeoutSeconds: 10 });
  assert.notEqual(result.isError, true);
  assert.match(toolText(result), /run the tests/);
  const bodies = fetchImpl.calls
    .filter((c) => c.url.includes('/api/face/command'))
    .map((c) => JSON.parse(c.init.body));
  assert.deepEqual(bodies, [{ type: 'listen', on: true }, { type: 'listen', on: false }]);
  const pollUrl = fetchImpl.calls.find((c) => c.url.includes('/api/face/listen')).url;
  assert.match(pollUrl, /timeout=10000/);
});

test('face_listen timeout still turns the mic off and reports a tool error', async () => {
  const fetchImpl = stubFetch([
    { match: '/api/face/command', body: { delivered: 1 } },
    { match: '/api/face/listen', body: { event: null, lastSeq: 7 } },
  ]);
  const tools = createTools({ fetchImpl });
  const result = await tools.call('face_listen', {});
  assert.equal(result.isError, true);
  const bodies = fetchImpl.calls
    .filter((c) => c.url.includes('/api/face/command'))
    .map((c) => JSON.parse(c.init.body));
  assert.deepEqual(bodies.at(-1), { type: 'listen', on: false });
});

test('face_ask speaks the prompt then listens for the reply', async () => {
  const fetchImpl = stubFetch([
    { match: '/api/face/say', body: { delivered: 1 } },
    { match: '/api/face/command', body: { delivered: 1 } },
    { match: '/api/face/listen', body: { event: { text: 'yes, ship it' }, lastSeq: 3 } },
  ]);
  const tools = createTools({ fetchImpl });
  const result = await tools.call('face_ask', { text: 'deploy to production?' });
  assert.notEqual(result.isError, true);
  assert.match(toolText(result), /yes, ship it/);
  assert.match(fetchImpl.calls[0].url, /\/api\/face\/say/);
});

test('face_status reports connected faces', async () => {
  const fetchImpl = stubFetch([{ match: '/api/face/status', body: { faces: 1, lastSeq: 42 } }]);
  const tools = createTools({ fetchImpl });
  const result = await tools.call('face_status', {});
  assert.match(toolText(result), /1/);
});

test('unknown tools and missing required arguments are tool errors', async () => {
  const tools = createTools({ fetchImpl: stubFetch([]) });
  assert.equal((await tools.call('face_hack', {})).isError, true);
  assert.equal((await tools.call('face_speak', {})).isError, true);
});

async function rpcSession(messages, { fetchImpl } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = runStdioServer({
    tools: createTools({ fetchImpl: fetchImpl || stubFetch([{ match: '/api/face/status', body: { faces: 1, lastSeq: 0 } }]) }),
    input,
    output,
  });
  const replies = [];
  output.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) replies.push(JSON.parse(line));
    }
  });
  for (const message of messages) input.write(`${JSON.stringify(message)}\n`);
  input.end();
  await done;
  return replies;
}

test('stdio server speaks MCP: initialize, tools/list, tools/call', async () => {
  const replies = await rpcSession([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'face_status', arguments: {} } },
  ]);
  assert.equal(replies.length, 3, 'notifications get no reply');
  const init = replies.find((r) => r.id === 1).result;
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.equal(init.serverInfo.name, 'codefall-face');
  assert.ok(init.capabilities.tools);
  const list = replies.find((r) => r.id === 2).result;
  assert.equal(list.tools.length, 6);
  const call = replies.find((r) => r.id === 3).result;
  assert.match(call.content[0].text, /1/);
});

test('stdio server answers malformed and unknown requests with JSON-RPC errors', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = runStdioServer({ tools: createTools({ fetchImpl: stubFetch([]) }), input, output });
  const replies = [];
  output.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) replies.push(JSON.parse(line));
    }
  });
  input.write('this is not json\n');
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'resources/list' })}\n`);
  input.end();
  await done;
  const parseError = replies.find((r) => r.error && r.error.code === -32700);
  assert.ok(parseError, 'parse error reply expected');
  const unknown = replies.find((r) => r.id === 9);
  assert.equal(unknown.error.code, -32601);
});
