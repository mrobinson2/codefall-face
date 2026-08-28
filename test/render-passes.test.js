import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASS_ORDER, renderFrame, backgroundPass, substrateMaterialVisible,
} from '../src/face/render-passes.js';
import { createFakePlatform } from './helpers/fake-platform.js';

test('renderFrame invokes ordered canvas passes', () => {
  const called = [];
  const platform = createFakePlatform();
  const canvas = platform.createCanvas();
  const passes = {};
  for (const name of PASS_ORDER.slice(1)) passes[name] = () => called.push(name);
  renderFrame({
    ctx: canvas.getContext('2d'), dpr: 1, width: 100, height: 100,
    reducedMotion: false, params: { regen: 1 }, passes,
  });
  assert.deepEqual(called, PASS_ORDER.slice(1));
});

test('reduced motion background is opaque and restores canvas state', () => {
  const platform = createFakePlatform();
  const canvas = platform.createCanvas();
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  backgroundPass({
    ctx, dpr: 1, width: 100, height: 100,
    reducedMotion: true, params: { regen: 0 },
  });
  assert.equal(canvas.operations.some((operation) =>
    operation[0] === 'fillRect' && operation[1] === 0 && operation[2] === 0), true);
  assert.equal(ctx.globalCompositeOperation, 'lighter');
});

test('substrate is exposed only inside an aperture breach', () => {
  assert.equal(substrateMaterialVisible(1, 0.9, {
    active: true, type: 'aperture-breach',
  }), true);
  assert.equal(substrateMaterialVisible(0, 0.9, {
    active: true, type: 'aperture-breach',
  }), false);
  assert.equal(substrateMaterialVisible(1, 0.9, {
    active: true, type: 'mask-slip',
  }), false);
});
