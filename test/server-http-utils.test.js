import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readJson, sendJson, applySecurityHeaders, createRequestId,
} from '../server/lib/http-utils.mjs';

function request(chunks) {
  return {
    destroyed: false,
    destroy() { this.destroyed = true; },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield Buffer.from(chunk); },
  };
}

function response() {
  return {
    status: null, headers: null, body: '',
    writeHead(status, headers) { this.status = status; this.headers = { ...(this.headers || {}), ...headers }; },
    setHeader(name, value) { (this.headers ||= {})[name] = value; },
    end(body = '') { this.body += body; },
  };
}

test('readJson accepts valid bounded input and rejects malformed or empty input', async () => {
  assert.deepEqual(await readJson(request(['{"ok":', 'true}'])), { ok: true });
  await assert.rejects(readJson(request(['{bad'])), (error) => error.code === 'bad-json');
  await assert.rejects(readJson(request([])), (error) => error.code === 'empty-json');
});

test('readJson accepts the byte boundary and terminates an oversized request early', async () => {
  const boundary = JSON.stringify({ value: 'x'.repeat(45) });
  assert.equal(Buffer.byteLength(boundary), 57);
  assert.equal((await readJson(request([boundary]), { maxBytes: 57 })).value.length, 45);
  const req = request(['{"value":"', 'x'.repeat(60), '"}']);
  await assert.rejects(readJson(req, { maxBytes: 32 }), (error) => error.code === 'json-too-large');
  assert.equal(req.destroyed, true);
});

test('JSON and security helpers set request identifiers and defensive headers', () => {
  const res = response();
  applySecurityHeaders(res, { requestId: 'req-1', csp: "default-src 'self'" });
  sendJson(res, 201, { ok: true });
  assert.equal(res.status, 201);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(res.headers['X-Request-Id'], 'req-1');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(res.headers['Content-Security-Policy'], "default-src 'self'");
  assert.match(res.headers['Content-Type'], /application\/json/);
});

test('request ids use injected entropy without exposing secrets', () => {
  assert.equal(createRequestId((length) => Buffer.alloc(length, 0xab)), 'abababababababab');
});
