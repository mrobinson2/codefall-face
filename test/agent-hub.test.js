import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentHub } from '../server/lib/agent-hub.mjs';

const WS_OPEN = 1;

function fakeTimers() {
  const pending = new Map();
  let id = 0;
  return {
    setTimeout(fn, ms) { const key = ++id; pending.set(key, { fn, ms }); return key; },
    clearTimeout(key) { pending.delete(key); },
    fire(key) { const entry = pending.get(key); pending.delete(key); entry?.fn(); },
    fireAll() { for (const key of [...pending.keys()]) this.fire(key); },
    get size() { return pending.size; },
  };
}

function fakeSocket() {
  const listeners = {};
  return {
    readyState: WS_OPEN,
    sent: [],
    send(msg) { this.sent.push(JSON.parse(msg)); },
    on(event, cb) { (listeners[event] ||= []).push(cb); },
    emit(event, ...args) { for (const cb of listeners[event] || []) cb(...args); },
  };
}

function request({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const closeListeners = [];
  return {
    method,
    url,
    headers,
    on(event, cb) { if (event === 'close') closeListeners.push(cb); },
    close() { for (const cb of closeListeners) cb(); },
    async *[Symbol.asyncIterator]() { if (body != null) yield Buffer.from(body); },
  };
}

function response() {
  return {
    status: null,
    headers: null,
    body: '',
    ended: false,
    writeHead(status, headers) { this.status = status; this.headers = { ...(this.headers || {}), ...headers }; return this; },
    setHeader(name, value) { (this.headers ||= {})[name] = value; },
    end(chunk = '') { this.body += chunk; this.ended = true; },
    json() { return JSON.parse(this.body); },
  };
}

function makeHub(options = {}) {
  const timers = fakeTimers();
  const webhookCalls = [];
  const hub = createAgentHub({
    timers,
    fetchImpl: async (url, init) => { webhookCalls.push({ url, init }); return { ok: true }; },
    ...options,
  });
  return { hub, timers, webhookCalls };
}

test('authorization is open without a token and enforces bearer or query token', () => {
  const { hub: open } = makeHub();
  assert.equal(open.authorized(request()), true);

  const { hub } = makeHub({ token: 'secret' });
  assert.equal(hub.authorized(request({ headers: { authorization: 'Bearer secret' } })), true);
  assert.equal(hub.authorized(request({ url: '/agent-hub?token=secret' })), true);
  assert.equal(hub.authorized(request({ headers: { authorization: 'Bearer nope' } })), false);
  assert.equal(hub.authorized(request()), false);
});

test('http requests without authorization are rejected with 401', async () => {
  const { hub } = makeHub({ token: 'secret' });
  const res = response();
  await hub.handleHttp(request({ url: '/api/face/status' }), res, '/api/face/status');
  assert.equal(res.status, 401);
});

test('status reports connected faces and last sequence', async () => {
  const { hub } = makeHub();
  const socket = fakeSocket();
  hub.handleSocket(socket);
  const res = response();
  await hub.handleHttp(request({ url: '/api/face/status' }), res, '/api/face/status');
  assert.equal(res.status, 200);
  assert.equal(res.json().faces, 1);
  assert.equal(typeof res.json().lastSeq, 'number');
});

test('every documented command type is accepted and broadcast', async () => {
  const { hub } = makeHub();
  const socket = fakeSocket();
  hub.handleSocket(socket);
  const commands = [
    { type: 'speak', text: 'hello' },
    { type: 'ask', text: 'ready?' },
    { type: 'emotion', emotion: 'focus' },
    { type: 'listen', on: true },
    { type: 'interrupt' },
    { type: 'mute', muted: true },
    { type: 'theme', theme: 'wintermute' },
    { type: 'geometry', geometry: 'chiseled' },
    { type: 'quality', quality: 'auto' },
    { type: 'visual-intensity', value: 0.8 },
  ];
  for (const cmd of commands) {
    const res = response();
    await hub.handleHttp(
      request({ method: 'POST', url: '/api/face/command', body: JSON.stringify(cmd) }),
      res,
      '/api/face/command',
    );
    assert.equal(res.status, 200, `${cmd.type} should be accepted`);
    assert.equal(res.json().delivered, 1);
  }
  assert.equal(socket.sent.length, commands.length);
  assert.deepEqual(socket.sent.at(-1), { type: 'visual-intensity', value: 0.8 });
});

test('malformed and unknown commands are rejected before broadcast', async () => {
  const { hub } = makeHub();
  const socket = fakeSocket();
  hub.handleSocket(socket);
  const bad = [
    '{not json',
    JSON.stringify({ type: 'self-destruct' }),
    JSON.stringify({ type: 'speak' }), // missing text
    JSON.stringify({ type: 'speak', text: 'ok', extra: 'field' }),
    JSON.stringify({ type: 'theme', theme: 'unknown-theme' }),
  ];
  for (const body of bad) {
    const res = response();
    await hub.handleHttp(request({ method: 'POST', url: '/api/face/command', body }), res, '/api/face/command');
    assert.equal(res.status, 400, `${body} should be rejected`);
  }
  assert.equal(socket.sent.length, 0);
});

test('say is sugar for speak and requires text', async () => {
  const { hub } = makeHub();
  const socket = fakeSocket();
  hub.handleSocket(socket);

  let res = response();
  await hub.handleHttp(
    request({ method: 'POST', url: '/api/face/say', body: JSON.stringify({ text: 'hi', emotion: 'joy' }) }),
    res,
    '/api/face/say',
  );
  assert.equal(res.status, 200);
  assert.deepEqual(socket.sent[0], { type: 'speak', text: 'hi', emotion: 'joy' });

  res = response();
  await hub.handleHttp(
    request({ method: 'POST', url: '/api/face/say', body: JSON.stringify({}) }),
    res,
    '/api/face/say',
  );
  assert.equal(res.status, 400);
});

test('broadcast counts only open sockets', () => {
  const { hub } = makeHub();
  const open = fakeSocket();
  const closed = fakeSocket();
  closed.readyState = 3;
  hub.handleSocket(open);
  hub.handleSocket(closed);
  assert.equal(hub.broadcast({ type: 'interrupt' }), 1);
});

test('face events land in the ring buffer with since filtering', async () => {
  const { hub } = makeHub({ maxEvents: 3 });
  const socket = fakeSocket();
  hub.handleSocket(socket); // records face_connected
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'state', state: 'idle' })));
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'transcript', role: 'user', text: 'yo', final: true })));

  const res = response();
  await hub.handleHttp(request({ url: '/api/face/events?since=0' }), res, '/api/face/events');
  const { events, lastSeq } = res.json();
  assert.equal(lastSeq, 3);
  assert.equal(events.length, 3);

  socket.emit('message', Buffer.from(JSON.stringify({ type: 'state', state: 'speaking' })));
  const res2 = response();
  await hub.handleHttp(request({ url: '/api/face/events?since=3' }), res2, '/api/face/events');
  assert.equal(res2.json().events.length, 1);
  assert.equal(res2.json().events[0].state, 'speaking');
});

test('socket close records disconnect and removes the face', () => {
  const { hub } = makeHub();
  const socket = fakeSocket();
  hub.handleSocket(socket);
  socket.emit('close');
  assert.equal(hub.broadcast({ type: 'interrupt' }), 0);
});

test('long-poll listen resolves with the next final user transcript', async () => {
  const { hub } = makeHub();
  const socket = fakeSocket();
  hub.handleSocket(socket);

  const res = response();
  const pending = hub.handleHttp(request({ url: '/api/face/listen?timeout=30000' }), res, '/api/face/listen');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'state', state: 'listening' })));
  assert.equal(res.ended, false, 'non-transcript events must not resolve the poll');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'transcript', role: 'agent', text: 'echo', final: true })));
  assert.equal(res.ended, false, 'agent transcripts must not resolve the poll');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'transcript', role: 'user', text: 'open the pod bay doors', final: true })));
  await pending;
  assert.equal(res.status, 200);
  assert.equal(res.json().event.text, 'open the pod bay doors');
  assert.equal(typeof res.json().lastSeq, 'number');
});

test('long-poll listen times out with a null event and clears its timer', async () => {
  const { hub, timers } = makeHub();
  const res = response();
  const pending = hub.handleHttp(request({ url: '/api/face/listen?timeout=5000' }), res, '/api/face/listen');
  assert.equal(timers.size, 1);
  timers.fireAll();
  await pending;
  assert.equal(res.status, 200);
  assert.equal(res.json().event, null);
  assert.equal(timers.size, 0);
});

test('a closed long-poll request stops waiting and never writes', async () => {
  const { hub, timers } = makeHub();
  const socket = fakeSocket();
  hub.handleSocket(socket);
  const req = request({ url: '/api/face/listen?timeout=30000' });
  const res = response();
  const pending = hub.handleHttp(req, res, '/api/face/listen');
  req.close();
  await pending;
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'transcript', role: 'user', text: 'late', final: true })));
  assert.equal(res.ended, false);
  assert.equal(timers.size, 0);
});

test('recorded events fan out to the configured webhook', async () => {
  const { hub, webhookCalls } = makeHub({ webhook: 'https://example.test/hook' });
  hub.recordEvent({ type: 'state', state: 'idle' });
  await Promise.resolve();
  assert.equal(webhookCalls.length, 1);
  assert.equal(webhookCalls[0].url, 'https://example.test/hook');
  assert.equal(JSON.parse(webhookCalls[0].init.body).state, 'idle');
});
