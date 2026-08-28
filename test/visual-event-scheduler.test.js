import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualEventScheduler } from '../src/runtime/visual-event-scheduler.js';
import { sequenceRandom } from './helpers/fake-random.js';

test('scheduler produces deterministic events for equal random streams', () => {
  const values = [0.9, 0, 0, 0.4, 0.5, 0.5, 0.5, 0.2, 0.2, 0.2];
  const a = new VisualEventScheduler({ random: sequenceRandom(values) });
  const b = new VisualEventScheduler({ random: sequenceRandom(values) });
  assert.deepEqual(a.tick(18, { rows: 80 }), b.tick(18, { rows: 80 }));
});

test('aperture breach duration never exceeds 650 milliseconds', () => {
  const scheduler = new VisualEventScheduler({ random: () => 0.999999 });
  const active = scheduler.tick(45, { rows: 100 });
  assert.equal(active.type, 'aperture-breach');
  assert.ok(scheduler.active.duration <= 0.65);
  scheduler.tick(0.651, { rows: 100 });
  assert.equal(scheduler.output.active, false);
});

test('medium and major events never overlap', () => {
  const scheduler = new VisualEventScheduler({ random: () => 0.7 });
  scheduler.tick(40, { rows: 100 });
  const firstStart = scheduler.active.start;
  scheduler.tick(0.1, { rows: 100 });
  assert.equal(scheduler.active.start, firstStart);
});

test('event bands remain clamped and displacement is bounded', () => {
  const scheduler = new VisualEventScheduler({ random: () => 0.99, intensity: 1 });
  const event = scheduler.tick(50, { rows: 32 });
  for (const band of event.bands) {
    assert.ok(band.start >= 0);
    assert.ok(band.start + band.height <= 32);
    assert.ok(Math.abs(band.offset) <= 12);
  }
});

test('active event ticks reuse the same band array', () => {
  const scheduler = new VisualEventScheduler({ random: () => 0.99, intensity: 1 });
  const first = scheduler.tick(50, { rows: 32 }).bands;
  const second = scheduler.tick(0.01, { rows: 32 }).bands;
  assert.equal(second, first);
});

test('reduced motion removes bands and rapid events', () => {
  const scheduler = new VisualEventScheduler({ random: () => 0.99 });
  const event = scheduler.tick(50, { rows: 100, reducedMotion: true });
  assert.equal(event.type, 'aperture-breach');
  assert.deepEqual(event.bands, []);
  assert.equal(event.haloDrop, 0);
});
