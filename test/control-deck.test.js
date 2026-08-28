import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlDeck } from '../src/ui/control-deck.js';

class Node extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    const values = new Set();
    this.classList = {
      add: (...items) => items.forEach((item) => values.add(item)),
      remove: (...items) => items.forEach((item) => values.delete(item)),
      contains: (item) => values.has(item),
      toggle: (item, force) => {
        const next = force === undefined ? !values.has(item) : force;
        if (next) values.add(item); else values.delete(item);
        return next;
      },
    };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    const index = this.parentNode?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parentNode.children.splice(index, 1);
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
}

class FakeFace extends EventTarget {
  constructor() {
    super();
    this.calls = [];
    this.theme = 'wintermute';
    this.geometry = 'chiseled';
    this.state = 'idle';
    this.muted = false;
    this.renderer = { fps: 60, cols: 50, rows: 60 };
    this.adapter = { name: 'local' };
  }
  on(type, callback) {
    const listener = (event) => callback(event.detail);
    this.addEventListener(type, listener);
    return () => this.removeEventListener(type, listener);
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  record(name, value) { this.calls.push([name, value]); return true; }
  setTheme(value) { this.theme = value; return this.record('setTheme', value); }
  setGeometry(value) { this.geometry = value; return this.record('setGeometry', value); }
  toggleGeometry() {
    return this.setGeometry(this.geometry === 'chiseled' ? 'smooth' : 'chiseled');
  }
  setQuality(value) { return this.record('setQuality', value); }
  setMotionPolicy(value) { return this.record('setMotionPolicy', value); }
  setVisualIntensity(value) { return this.record('setVisualIntensity', value); }
  setEmotion(value) { return this.record('setEmotion', value); }
  ask(value) { return Promise.resolve(this.record('ask', value)); }
  startListening() { return Promise.resolve(this.record('startListening')); }
  stopListening() { return Promise.resolve(this.record('stopListening')); }
  interrupt() { return this.record('interrupt'); }
  setMuted(value) { this.muted = value; return this.record('setMuted', value); }
  retryProvider() { return Promise.resolve(this.record('retryProvider')); }
  getSnapshot() {
    return {
      face: { coherence: 1 },
      rendering: { fps: 60, visualIntensity: 0.65 },
    };
  }
}

function setup() {
  const selectors = [
    '#emotions', '#console', '#console-toggle', '#status', '#provider', '#listen',
    '#provider-retry', '#transcript', '#live-status', '#say-input', '#say-btn',
    '#interrupt', '#mute', '#demo', '#theme-toggle', '#geometry-toggle', '#quality',
    '#motion-policy', '#visual-intensity', '#snapshot-copy', '#debug-toggle', '#debug',
    '#debug-stats', '#visual-event',
  ];
  const nodes = new Map(selectors.map((selector) => [selector, new Node()]));
  const root = {
    defaultView: { navigator: { clipboard: { writeText: async () => {} } } },
    createElement: () => new Node(),
    querySelector: (selector) => nodes.get(selector) || null,
    querySelectorAll: () => [],
  };
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  const face = new FakeFace();
  const deck = new ControlDeck({ root, face, storage });
  return { deck, face, nodes };
}

test('control deck uses public facade controls and removes listeners', () => {
  const { deck, face, nodes } = setup();
  deck.mount();
  const baseline = face.calls.length;
  nodes.get('#geometry-toggle').dispatchEvent(new Event('click'));
  nodes.get('#quality').value = 'low';
  nodes.get('#quality').dispatchEvent(new Event('change'));
  assert.deepEqual(face.calls.slice(baseline), [
    ['setGeometry', 'smooth'], ['setQuality', 'low'],
  ]);
  deck.destroy();
  nodes.get('#geometry-toggle').dispatchEvent(new Event('click'));
  assert.equal(face.calls.length, baseline + 2);
});

test('capabilities update labels and partial transcripts stay out of live region', (t) => {
  const { deck, face, nodes } = setup();
  deck.mount();
  t.after(() => deck.destroy());
  face.emit('capabilities', { stt: false, retry: true });
  assert.equal(nodes.get('#listen').disabled, true);
  assert.equal(nodes.get('#provider-retry').hidden, false);
  face.emit('transcript', { role: 'agent', text: 'part', final: false });
  assert.equal(nodes.get('#live-status').textContent, '');
  face.emit('transcript', { role: 'agent', text: 'complete', final: true });
  assert.equal(nodes.get('#live-status').textContent, 'agent: complete');
});
