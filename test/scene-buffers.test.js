import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneBuffers } from '../src/face/scene-buffers.js';

test('equal-size resize reuses every typed array identity', () => {
  const buffers = new SceneBuffers({ glyphRandom: () => 0.25, churnRandom: () => 0.75 });
  assert.equal(buffers.resize(20, 12), true);
  const identities = Object.values(buffers.arrays);
  assert.equal(buffers.resize(20, 12), false);
  assert.deepEqual(Object.values(buffers.arrays), identities);
  assert.equal(buffers.length, 240);
});

test('changed dimensions replace required arrays with correct types', () => {
  const buffers = new SceneBuffers();
  buffers.resize(4, 3);
  const first = buffers.brightness;
  buffers.resize(5, 3);
  assert.notEqual(buffers.brightness, first);
  for (const key of ['brightness', 'distance', 'depth', 'substrate', 'churnPhase']) {
    assert.ok(buffers[key] instanceof Float32Array, key);
  }
  for (const key of ['region', 'material']) assert.ok(buffers[key] instanceof Uint8Array, key);
  assert.ok(buffers.glyph instanceof Uint16Array);
});

test('clearFrame clears transient fields without touching persistent churn', () => {
  const buffers = new SceneBuffers({ glyphRandom: () => 0.5, churnRandom: () => 0.75 });
  buffers.resize(3, 2);
  buffers.brightness.fill(1);
  buffers.region.fill(7);
  buffers.distance.fill(1);
  buffers.material.fill(5);
  buffers.depth.fill(1);
  buffers.substrate.fill(1);
  const glyph = [...buffers.glyph];
  const churn = [...buffers.churnPhase];
  buffers.clearFrame();
  for (const key of ['brightness', 'region', 'distance', 'material', 'depth', 'substrate']) {
    assert.ok(buffers[key].every((value) => value === 0), key);
  }
  assert.deepEqual([...buffers.glyph], glyph);
  assert.deepEqual([...buffers.churnPhase], churn);
});

test('invalid scene dimensions throw', () => {
  const buffers = new SceneBuffers();
  for (const dimensions of [[0, 1], [1, -1], [1.2, 2], [Infinity, 2]]) {
    assert.throws(() => buffers.resize(...dimensions), /dimensions/i);
  }
});
