import test from 'node:test';
import assert from 'node:assert/strict';
import { GazeController } from '../src/runtime/gaze-controller.js';
import { sequenceRandom } from './helpers/fake-random.js';

test('idle gaze chooses a bounded target and converges without overshoot', () => {
  const gaze = new GazeController({ gazeRandom: sequenceRandom([1, 1, 1]) });
  const out = gaze.tick(0.1, 'idle', false);
  assert.ok(out.x >= -0.6 && out.x <= 0.6);
  assert.ok(out.y >= -0.4 && out.y <= 0.4);
  assert.equal(out.x, 0.6);
  assert.equal(out.y, 0.4);
});

test('thinking saccades use the wider documented bounds', () => {
  const gaze = new GazeController({ gazeRandom: sequenceRandom([1, 1, 0]) });
  const out = gaze.tick(0.1, 'thinking', false);
  assert.equal(out.x, 1.2);
  assert.equal(out.y, 0.8);
});

test('listening gaze focuses above center', () => {
  const gaze = new GazeController();
  const out = gaze.tick(0.1, 'listening', false);
  assert.equal(out.x, 0);
  assert.equal(out.y, -0.3);
});

test('blink closes and reopens on a deterministic schedule', () => {
  const gaze = new GazeController({ blinkRandom: () => 0 });
  gaze.tick(1.8, 'idle', false);
  const closed = gaze.tick(0.11, 'idle', false);
  assert.ok(closed.blink < 0.05);
  const open = gaze.tick(0.11, 'idle', false);
  assert.equal(open.blink, 1);
});

test('reduced motion suppresses wander and blink', () => {
  const gaze = new GazeController({ gazeRandom: () => 1, blinkRandom: () => 0 });
  const out = gaze.tick(5, 'thinking', true);
  assert.deepEqual(out, { x: 0, y: 0, blink: 1 });
});
