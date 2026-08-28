import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceRuntime } from '../src/runtime/face-runtime.js';
import { createRandomStreams } from '../src/runtime/random.js';
import { SpeechEngine } from '../src/speech/speech-engine.js';

function runtime(seed = 19, reducedMotion = false) {
  const streams = createRandomStreams(seed);
  return new FaceRuntime({
    config: {
      face: { bootDuration: 0.5, reducedMotion, visualIntensity: 0.65 },
    },
    speech: new SpeechEngine(streams.speech),
    streams,
    rows: 72,
  });
}

function trace(instance, seconds = 60) {
  const events = [];
  let previous = 'none:idle';
  let maxOffset = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const out = instance.tick(1 / 60).visualEvent;
    const key = `${out.type}:${out.phase}`;
    if (key !== previous) {
      events.push([frame, out.type, out.phase]);
      previous = key;
    }
    for (const band of out.bands) maxOffset = Math.max(maxOffset, Math.abs(band.offset));
  }
  return { events, maxOffset };
}

test('seeded sixty-second event grammar is deterministic and bounded', () => {
  const a = trace(runtime(917));
  const b = trace(runtime(917));
  assert.deepEqual(a, b);
  assert.ok(a.events.some((event) => event[1] !== 'none'));
  assert.ok(a.maxOffset <= 12);
  const activeTypes = new Set(a.events.filter((event) => event[1] !== 'none').map((event) => event[1]));
  assert.ok(activeTypes.size >= 2);
});

test('runtime emits only visual event phase changes', () => {
  const face = runtime(33);
  const emitted = [];
  face.addEventListener('visualevent', (event) => emitted.push(event.detail));
  trace(face, 30);
  assert.ok(emitted.length > 0);
  for (let i = 1; i < emitted.length; i++) {
    assert.notDeepEqual(emitted[i], emitted[i - 1]);
  }
});

test('reduced motion suppresses desync and displacement', () => {
  const result = trace(runtime(917, true));
  assert.equal(result.maxOffset, 0);
  assert.equal(result.events.some((event) =>
    event[1] === 'ocular-desync' || event[1] === 'mask-slip'), false);
});

test('visual intensity clamps and changes future cadence', () => {
  const low = runtime(51);
  const high = runtime(51);
  low.command({ type: 'visual-intensity', value: -3 });
  high.command({ type: 'visual-intensity', value: 9 });
  assert.equal(low.getSnapshot().visualIntensity, 0);
  assert.equal(high.getSnapshot().visualIntensity, 1);
  const lowFirst = trace(low, 20).events.find((event) => event[1] !== 'none');
  const highFirst = trace(high, 20).events.find((event) => event[1] !== 'none');
  assert.ok(highFirst[0] < lowFirst[0]);
});
