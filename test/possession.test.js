import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBand, PossessionController } from '../src/face/possession.js';

const fixedRandom = () => 0;
const nearOneRandom = () => 0.999999;

test('clampBand keeps a band inside the grid', () => {
  assert.deepEqual(clampBand(-3, 9, 20), { start: 0, height: 6 });
  assert.deepEqual(clampBand(18, 8, 20), { start: 18, height: 2 });
});

test('controller waits at least seven seconds before a breach', () => {
  const controller = new PossessionController(fixedRandom);
  assert.equal(controller.update(6.99, { rows: 40 }).active, false);
  assert.equal(controller.update(7, { rows: 40 }).active, true);
});

test('initial schedule spans the documented seven-to-eighteen-second range', () => {
  assert.equal(new PossessionController(fixedRandom).nextAt, 7);
  const nearMaximum = new PossessionController(nearOneRandom).nextAt;
  assert.ok(nearMaximum < 18);
  assert.ok(nearMaximum > 17.999);
});

test('event duration spans 0.18 seconds to just under 0.65 seconds', () => {
  const minimum = new PossessionController(fixedRandom);
  minimum.update(minimum.nextAt, { rows: 40 });
  assert.equal(minimum.active.duration, 0.18);

  const nearMaximum = new PossessionController(nearOneRandom);
  nearMaximum.update(nearMaximum.nextAt, { rows: 40 });
  assert.ok(nearMaximum.active.duration < 0.65);
  assert.ok(nearMaximum.active.duration > 0.6499);
});

test('event stays active before its duration and ends at the duration', () => {
  const controller = new PossessionController(fixedRandom);
  const start = controller.nextAt;
  controller.update(start, { rows: 40 });
  const duration = controller.active.duration;

  assert.equal(controller.update(start + duration - 1e-9, { rows: 40 }).active, true);
  assert.equal(controller.update(start + duration, { rows: 40 }).active, false);
  assert.equal(controller.nextAt, start + duration + 7);
});

test('reset clears an active event and schedules a future event', () => {
  const controller = new PossessionController(fixedRandom);
  controller.update(controller.nextAt, { rows: 40 });
  assert.ok(controller.active);

  controller.reset(25);

  assert.equal(controller.active, null);
  assert.equal(controller.nextAt, 32);
  assert.equal(controller.update(31.999, { rows: 40 }).active, false);
});

test('reduced motion suppresses possession output', () => {
  const controller = new PossessionController(fixedRandom);
  controller.update(controller.nextAt, { rows: 40 });
  assert.ok(controller.active);

  const frame = controller.update(20, { rows: 40, reducedMotion: true });
  assert.deepEqual(frame, {
    active: false, envelope: 0, bands: [], aperture: null, haloDrop: 0,
  });
  assert.equal(controller.active, null);
  assert.equal(controller.nextAt, 27);
});

test('an event ends and schedules a future event', () => {
  const controller = new PossessionController(fixedRandom);
  controller.update(7, { rows: 40 });
  assert.equal(controller.update(7.7, { rows: 40 }).active, false);
  assert.equal(controller.update(13, { rows: 40 }).active, false);
  assert.equal(controller.update(14.7, { rows: 40 }).active, true);
});

test('next event is scheduled between seven and eighteen seconds after end', () => {
  const controller = new PossessionController(nearOneRandom);
  const start = controller.nextAt;
  controller.update(start, { rows: 40 });
  const end = start + controller.active.duration;
  controller.update(end, { rows: 40 });

  assert.ok(controller.nextAt - end >= 7);
  assert.ok(controller.nextAt - end < 18);
  assert.ok(controller.nextAt - end > 17.999);
});
