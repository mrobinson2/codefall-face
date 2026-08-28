import test from 'node:test';
import assert from 'node:assert/strict';
import { CodefallRenderer } from '../src/face/renderer.js';
import { FaceModel } from '../src/face/face-model.js';
import { NEUTRAL } from '../src/face/emotions.js';
import { createRandomStreams } from '../src/runtime/random.js';
import { createFakePlatform } from './helpers/fake-platform.js';

function frame(visualEvent = null) {
  return {
    mode: 'idle',
    params: { ...NEUTRAL },
    dyn: {
      t: 1, coherence: 1, gazeX: 0, gazeY: 0, blink: 1,
      mouthOpen: 0.45, mouthWide: 0.25, tension: 0.4, energy: 0.5,
      swayX: 0, swayY: 0,
    },
    visualEvent: visualEvent || {
      active: false, type: 'none', phase: 'idle', envelope: 0,
      bands: [], aperture: null, haloDrop: 0, eyeSide: 0,
    },
  };
}

test('renderer composes a detailed wintermute frame with reusable buffers', () => {
  const platform = createFakePlatform({ width: 640, height: 640, dpr: 1 });
  const canvas = platform.createCanvas();
  const streams = createRandomStreams(31);
  const renderer = new CodefallRenderer(canvas, new FaceModel('chiseled'), {
    platform, streams, quality: 'medium', theme: 'wintermute', reducedMotion: false,
  });
  const buffers = renderer.buffers;
  renderer.render(1 / 60, frame());
  assert.equal(renderer.buffers, buffers);
  assert.ok(renderer.depth.some((value) => value > 0.5));
  assert.ok(renderer.substrate.some((value) => value > 0.5));
  assert.ok(canvas.operations.some(([name]) => name === 'drawImage'));
  assert.equal(renderer.ctx.globalCompositeOperation, 'source-over');
  renderer.destroy();
});

test('aperture breach reveals machinery while keeping displacement bounded', () => {
  const platform = createFakePlatform({ width: 640, height: 640, dpr: 1 });
  const canvas = platform.createCanvas();
  const renderer = new CodefallRenderer(canvas, new FaceModel('chiseled'), {
    platform,
    streams: createRandomStreams(32),
    quality: 'low',
    theme: 'wintermute',
  });
  renderer.render(1 / 60, frame({
    active: true,
    type: 'aperture-breach',
    phase: 'active',
    envelope: 1,
    bands: [{ start: 12, height: 20, offset: 12 }],
    aperture: { side: 1, y: 0.1, radius: 0.1 },
    haloDrop: 0.55,
    eyeSide: 0,
  }));
  assert.ok(canvas.operations.some(([name]) => name === 'arc'));
  assert.ok(canvas.operations.filter(([name]) => name === 'drawImage').length > 10);
  renderer.destroy();
});
