import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityController } from '../src/face/quality-controller.js';

function sampleWindow(controller, milliseconds, options) {
  for (let i = 0; i < 120; i++) controller.sample(milliseconds, options);
}

test('explicit quality tiers stay fixed under frame samples', () => {
  const quality = new QualityController({ policy: 'medium', now: () => 0 });
  quality.chooseInitial({ width: 1800, height: 1200, dpr: 2 });
  for (let i = 0; i < 20; i++) sampleWindow(quality, i % 2 ? 8 : 40);
  assert.deepEqual(quality.getSnapshot(), { policy: 'medium', tier: 'medium' });
});

test('auto quality derives its initial tier from viewport cost', () => {
  const low = new QualityController({ policy: 'auto', now: () => 0 });
  assert.equal(low.chooseInitial({ width: 360, height: 640, dpr: 3 }), 'low');
  const medium = new QualityController({ policy: 'auto', now: () => 0 });
  assert.equal(medium.chooseInitial({ width: 800, height: 600, dpr: 2 }), 'medium');
  const high = new QualityController({ policy: 'auto', now: () => 0 });
  assert.equal(high.chooseInitial({ width: 1440, height: 900, dpr: 1 }), 'high');
});

test('two slow windows step down and four fast windows step up', () => {
  let now = 0;
  const quality = new QualityController({ policy: 'auto', now: () => now });
  quality.chooseInitial({ width: 1400, height: 900, dpr: 1 });
  sampleWindow(quality, 28);
  assert.equal(quality.getSnapshot().tier, 'high');
  sampleWindow(quality, 28);
  assert.equal(quality.getSnapshot().tier, 'medium');
  now += 8000;
  for (let i = 0; i < 3; i++) sampleWindow(quality, 9);
  assert.equal(quality.getSnapshot().tier, 'medium');
  sampleWindow(quality, 9);
  assert.equal(quality.getSnapshot().tier, 'high');
});

test('quality changes enforce an eight-second cooldown', () => {
  let now = 100;
  const quality = new QualityController({ policy: 'auto', now: () => now });
  quality.chooseInitial({ width: 1400, height: 900, dpr: 1 });
  sampleWindow(quality, 30);
  sampleWindow(quality, 30);
  assert.equal(quality.getSnapshot().tier, 'medium');
  sampleWindow(quality, 30);
  sampleWindow(quality, 30);
  assert.equal(quality.getSnapshot().tier, 'medium');
  now += 7999;
  sampleWindow(quality, 30);
  sampleWindow(quality, 30);
  assert.equal(quality.getSnapshot().tier, 'medium');
  now += 1;
  sampleWindow(quality, 30);
  sampleWindow(quality, 30);
  assert.equal(quality.getSnapshot().tier, 'low');
});

test('hidden and resizing frames do not enter quality windows', () => {
  const quality = new QualityController({ policy: 'auto', now: () => 10000 });
  quality.chooseInitial({ width: 1400, height: 900, dpr: 1 });
  for (let i = 0; i < 1000; i++) quality.sample(40, { hidden: true });
  for (let i = 0; i < 1000; i++) quality.sample(40, { resizing: true });
  assert.equal(quality.getSnapshot().tier, 'high');
});

test('tiers never move below low or above high and events are material', () => {
  let now = 0;
  const quality = new QualityController({ policy: 'auto', now: () => now });
  const changes = [];
  quality.addEventListener('change', (event) => changes.push(event.detail));
  quality.chooseInitial({ width: 360, height: 640, dpr: 3 });
  for (let cycle = 0; cycle < 5; cycle++) {
    sampleWindow(quality, 40); sampleWindow(quality, 40); now += 8000;
  }
  assert.equal(quality.getSnapshot().tier, 'low');
  const count = changes.length;
  quality.setPolicy('low');
  quality.setPolicy('low');
  assert.equal(changes.length, count + 1);
  assert.equal(changes.at(-1).reason, 'policy');
});
