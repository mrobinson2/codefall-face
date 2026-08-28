import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandomStreams } from '../src/runtime/random.js';

test('equal seeds produce equal named random streams', () => {
  const a = createRandomStreams(1234);
  const b = createRandomStreams(1234);
  for (const name of ['gaze', 'blink', 'rain', 'debris', 'events']) {
    assert.deepEqual([a[name](), a[name](), a[name]()], [b[name](), b[name](), b[name]()]);
  }
});

test('consuming one named stream does not advance another', () => {
  const a = createRandomStreams(99);
  const b = createRandomStreams(99);
  for (let i = 0; i < 10; i++) a.gaze();
  assert.equal(a.events(), b.events());
});

test('unknown stream names are rejected', () => {
  assert.throws(() => createRandomStreams(1, ['gaze', '']), /stream name/i);
  assert.throws(() => createRandomStreams(1, ['gaze', 'gaze']), /duplicate/i);
});
