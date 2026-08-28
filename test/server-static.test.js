import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStaticHandler } from '../server/lib/static-handler.mjs';

function response() {
  return {
    status: null, headers: {}, body: Buffer.alloc(0),
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body = Buffer.isBuffer(body) ? body : Buffer.from(body); },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codefall-static-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'server'));
  await mkdir(join(root, '.git'));
  await writeFile(join(root, 'index.html'), '<h1>face</h1>');
  await writeFile(join(root, 'styles.css'), 'body{}');
  await writeFile(join(root, 'src', 'main.js'), 'export{}');
  await writeFile(join(root, 'server', '.env'), 'SECRET=x');
  await writeFile(join(root, '.git', 'config'), 'private');
  return { root, handler: createStaticHandler({ root }) };
}

test('static handler serves root assets, HEAD, ETag, and cache policy', async () => {
  const { handler } = await fixture();
  const html = response();
  await handler.handle({ method: 'GET', url: '/', headers: {} }, html);
  assert.equal(html.status, 200);
  assert.match(html.headers['Content-Type'], /text\/html/);
  assert.equal(html.headers['Cache-Control'], 'no-cache');
  assert.ok(html.headers.ETag);
  const head = response();
  await handler.handle({ method: 'HEAD', url: '/src/main.js', headers: {} }, head);
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  const cached = response();
  await handler.handle({
    method: 'GET', url: '/styles.css', headers: { 'if-none-match': html.headers.ETag },
  }, cached);
  assert.ok([200, 304].includes(cached.status));
});

test('static handler denies traversal, dotfiles, server and model resources', async () => {
  const { handler } = await fixture();
  for (const url of [
    '/..%2Fserver/.env', '/server/.env', '/.git/config', '/voices/model.onnx',
    '/piper-venv/bin/piper', '/docs/superpowers/plan.md', '/src/main.js.map', '/missing',
  ]) {
    const res = response();
    await handler.handle({ method: 'GET', url, headers: {} }, res);
    assert.equal(res.status, 404, url);
  }
});

test('static handler rejects unsupported methods and directories', async () => {
  const { handler } = await fixture();
  const post = response();
  await handler.handle({ method: 'POST', url: '/', headers: {} }, post);
  assert.equal(post.status, 405);
  const directory = response();
  await handler.handle({ method: 'GET', url: '/src/', headers: {} }, directory);
  assert.equal(directory.status, 404);
});
