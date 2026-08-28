import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceRuntime } from '../src/runtime/face-runtime.js';
import { createRandomStreams } from '../src/runtime/random.js';
import { SpeechEngine } from '../src/speech/speech-engine.js';

function makeRuntime(overrides = {}) {
  const speech = overrides.speech || new SpeechEngine(() => 0.5);
  const runtime = new FaceRuntime({
    config: {
      face: {
        bootDuration: 1,
        reducedMotion: false,
        visualIntensity: 0.65,
      },
    },
    speech,
    streams: createRandomStreams(7),
    rows: 80,
  });
  return { runtime, speech };
}

test('tick reuses one frame and nested dynamics object', () => {
  const { runtime } = makeRuntime();
  const first = runtime.tick(0.016);
  const dynamics = first.dyn;
  const second = runtime.tick(0.016);
  assert.equal(second, first);
  assert.equal(second.dyn, dynamics);
});

test('boot reaches idle after configured coherence assembly', () => {
  const { runtime } = makeRuntime();
  for (let i = 0; i < 30; i++) runtime.tick(0.1);
  assert.equal(runtime.state, 'idle');
  assert.ok(runtime.frame.dyn.coherence > 0.92);
});

test('emotion parameters converge without overshoot', () => {
  const { runtime } = makeRuntime();
  runtime.command({ type: 'emotion', value: 'anger' });
  for (let i = 0; i < 20; i++) runtime.tick(0.05);
  assert.ok(runtime.frame.params.browAngle >= -0.5);
  assert.ok(runtime.frame.params.browAngle < -0.3);
  assert.equal(runtime.emotion, 'anger');
});

test('provider speech state drives real speech dynamics', () => {
  const { runtime, speech } = makeRuntime();
  runtime.command({ type: 'provider-state', value: 'speaking' });
  speech.fakePulse(1, 0.3);
  runtime.tick(0.05);
  assert.equal(runtime.state, 'speaking');
  assert.ok(runtime.frame.dyn.mouthOpen > 0);
  assert.ok(runtime.frame.dyn.energy > 0);
});

test('interrupt lowers coherence then recovers to idle', () => {
  const { runtime } = makeRuntime();
  for (let i = 0; i < 30; i++) runtime.tick(0.1);
  runtime.command({ type: 'provider-state', value: 'speaking' });
  runtime.command({ type: 'interrupt' });
  assert.equal(runtime.state, 'interrupted');
  assert.ok(runtime.frame.dyn.coherence <= 0.45);
  runtime.tick(0.8);
  assert.equal(runtime.state, 'idle');
});

test('pause freezes time and resume avoids a delta spike', () => {
  const { runtime } = makeRuntime();
  runtime.tick(0.1);
  runtime.command({ type: 'pause' });
  const time = runtime.frame.dyn.t;
  runtime.tick(10);
  assert.equal(runtime.frame.dyn.t, time);
  runtime.command({ type: 'resume' });
  runtime.tick(0.016);
  assert.equal(runtime.frame.dyn.t, time + 0.016);
});

test('destroy makes commands inert and returns a destroyed snapshot', () => {
  const { runtime } = makeRuntime();
  runtime.destroy();
  assert.equal(runtime.command({ type: 'emotion', value: 'joy' }), false);
  assert.equal(runtime.getSnapshot().state, 'destroyed');
});
