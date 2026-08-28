import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechEngine } from '../src/speech/speech-engine.js';

test('text pulses use injected randomness and decay while speaking', () => {
  const speech = new SpeechEngine(() => 0);
  speech.setSpeaking(true);
  speech.textPulse(4);
  speech.tick(0.05);
  assert.ok(speech.out.open > 0);
  assert.ok(speech.out.energy > 0);
  assert.equal(speech._pulseLevel, 0.55);
});

test('waveform analyser drives finite speech channels', () => {
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 8,
    disconnects: 0,
    getByteTimeDomainData(data) { data.fill(160); },
    getByteFrequencyData(data) { data.fill(64); },
    disconnect() { this.disconnects++; },
  };
  const audioCtx = { createAnalyser: () => analyser };
  const source = { connect(node) { assert.equal(node, analyser); } };
  const speech = new SpeechEngine();
  speech.attachAnalyser(audioCtx, source);
  speech.setSpeaking(true);
  speech.tick(0.05);
  for (const value of Object.values(speech.out)) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1);
  }
});

test('replacing and detaching analysers disconnects the previous node once', () => {
  const created = [];
  const audioCtx = {
    createAnalyser() {
      const analyser = {
        fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, disconnects: 0,
        disconnect() { this.disconnects++; },
      };
      created.push(analyser);
      return analyser;
    },
  };
  const source = { connect() {} };
  const speech = new SpeechEngine();
  speech.attachAnalyser(audioCtx, source);
  speech.attachAnalyser(audioCtx, source);
  speech.detach();
  speech.detach();
  assert.deepEqual(created.map((item) => item.disconnects), [1, 1]);
});
