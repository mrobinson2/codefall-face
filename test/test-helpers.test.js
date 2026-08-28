import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from './helpers/fake-clock.js';
import { seededRandom, sequenceRandom } from './helpers/fake-random.js';
import { createFakePlatform } from './helpers/fake-platform.js';

test('fake clock executes due and nested timers in chronological order', () => {
  const clock = new FakeClock();
  const seen = [];
  clock.setTimeout(() => seen.push('late'), 20);
  clock.setTimeout(() => {
    seen.push('early');
    clock.setTimeout(() => seen.push('nested'), 5);
  }, 10);

  clock.advance(30);

  assert.deepEqual(seen, ['early', 'nested', 'late']);
  assert.deepEqual(clock.pending(), { timers: 0, animationFrames: 0 });
});

test('fake clock runs each queued animation frame once at the target time', () => {
  const clock = new FakeClock();
  const seen = [];
  clock.requestAnimationFrame((now) => {
    seen.push(now);
    clock.requestAnimationFrame((next) => seen.push(next));
  });

  clock.advance(16);
  assert.deepEqual(seen, [16]);
  assert.deepEqual(clock.pending(), { timers: 0, animationFrames: 1 });

  clock.advance(16);
  assert.deepEqual(seen, [16, 32]);
});

test('random helpers are repeatable and sequence fallback is stable', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);

  const sequence = sequenceRandom([0.1, 0.9], 0.25);
  assert.deepEqual([sequence(), sequence(), sequence()], [0.1, 0.9, 0.25]);
});

test('fake platform tracks listeners, visibility, resize, and sockets', () => {
  const platform = createFakePlatform({ width: 640, height: 480, reducedMotion: true });
  let resized = 0;
  const onResize = () => resized++;
  platform.window.addEventListener('resize', onResize);
  assert.equal(platform.listenerCount(platform.window, 'resize'), 1);
  platform.dispatchResize();
  assert.equal(resized, 1);
  platform.window.removeEventListener('resize', onResize);
  assert.equal(platform.listenerCount(platform.window, 'resize'), 0);

  assert.equal(platform.matchMedia('(prefers-reduced-motion: reduce)').matches, true);
  platform.setHidden(true);
  assert.equal(platform.document.hidden, true);

  const socket = platform.createWebSocket('ws://example.test/agent');
  socket.open();
  socket.send('hello');
  assert.deepEqual(socket.sent, ['hello']);
  socket.close();
  assert.equal(socket.readyState, socket.CLOSED);
});
