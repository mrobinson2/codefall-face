import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBand, PossessionController } from '../src/face/possession.js';

const fixedRandom = () => 0;

test('clampBand keeps a band inside the grid', () => {
  assert.deepEqual(clampBand(-3, 9, 20), { start: 0, height: 6 });
  assert.deepEqual(clampBand(18, 8, 20), { start: 18, height: 2 });
});

test('controller waits at least seven seconds before a breach', () => {
  const controller = new PossessionController(fixedRandom);
  assert.equal(controller.update(6.99, { rows: 40 }).active, false);
  assert.equal(controller.update(7, { rows: 40 }).active, true);
});

test('reduced motion suppresses possession output', () => {
  const controller = new PossessionController(fixedRandom);
  const frame = controller.update(20, { rows: 40, reducedMotion: true });
  assert.deepEqual(frame, {
    active: false, envelope: 0, bands: [], aperture: null, haloDrop: 0,
  });
});

test('an event ends and schedules a future event', () => {
  const controller = new PossessionController(fixedRandom);
  controller.update(7, { rows: 40 });
  assert.equal(controller.update(7.7, { rows: 40 }).active, false);
  assert.equal(controller.update(13, { rows: 40 }).active, false);
  assert.equal(controller.update(14.7, { rows: 40 }).active, true);
});
