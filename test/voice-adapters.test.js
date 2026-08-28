import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceAdapter } from '../src/voice/adapter.js';
import { LocalSpeechAdapter } from '../src/voice/local-speech.js';
import { attachGhostFx } from '../src/voice/voice-fx.js';

function audioNode(extra = {}) {
  return {
    connectCalls: 0,
    disconnectCalls: 0,
    connect() { this.connectCalls++; },
    disconnect() { this.disconnectCalls++; },
    ...extra,
  };
}

test('VoiceAdapter owns an idempotent disposer collection', () => {
  const adapter = new VoiceAdapter({});
  let calls = 0;
  adapter.addDisposer(() => calls++);
  assert.equal(adapter.destroy(), true);
  assert.equal(adapter.destroy(), false);
  assert.equal(calls, 1);
  adapter.addDisposer(() => calls++);
  assert.equal(calls, 2);
});

test('ghost FX stops its oscillator and disconnects nodes exactly once', () => {
  const nodes = [];
  const osc = audioNode({
    frequency: { value: 0 }, startCalls: 0, stopCalls: 0,
    start() { this.startCalls++; }, stop() { this.stopCalls++; },
  });
  const ctx = {
    createGain() { const node = audioNode({ gain: { value: 0 } }); nodes.push(node); return node; },
    createOscillator() { nodes.push(osc); return osc; },
    createWaveShaper() { const node = audioNode(); nodes.push(node); return node; },
    createBiquadFilter() {
      const node = audioNode({ frequency: { value: 0 } }); nodes.push(node); return node;
    },
  };
  const input = audioNode();
  const fx = attachGhostFx(ctx, input);
  assert.ok(fx.output);
  assert.equal(osc.startCalls, 1);
  assert.equal(fx.destroy(), true);
  assert.equal(fx.destroy(), false);
  assert.equal(osc.stopCalls, 1);
  assert.ok(nodes.every((node) => node.disconnectCalls === 1));
  assert.equal(input.disconnectCalls, 1);
});

test('interrupt resolves muted local speech exactly once', async (t) => {
  const originalWindow = globalThis.window;
  const originalSynthesis = globalThis.speechSynthesis;
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const synthesis = {
    speaking: false,
    getVoices: () => [{ name: 'Test', lang: 'en-US' }],
    speak() {}, cancel() {}, onvoiceschanged: null,
  };
  globalThis.window = { speechSynthesis: synthesis };
  globalThis.speechSynthesis = synthesis;
  globalThis.SpeechSynthesisUtterance = class {};
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalSynthesis === undefined) delete globalThis.speechSynthesis;
    else globalThis.speechSynthesis = originalSynthesis;
    if (originalUtterance === undefined) delete globalThis.SpeechSynthesisUtterance;
    else globalThis.SpeechSynthesisUtterance = originalUtterance;
  });

  const adapter = new LocalSpeechAdapter({
    local: { rate: 1, pitch: 1, preferredVoices: [] },
  });
  await adapter.init();
  adapter.setMuted(true);
  let endings = 0;
  adapter.addEventListener('speechend', () => endings++);
  const speaking = adapter.speak('signal borrowed from elsewhere');
  adapter.interrupt();
  const resolved = await Promise.race([
    speaking.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  assert.equal(resolved, true);
  assert.equal(endings, 1);
  assert.equal(adapter.destroy(), true);
  assert.equal(adapter.destroy(), false);
});
