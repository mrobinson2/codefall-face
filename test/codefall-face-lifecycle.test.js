import test from 'node:test';
import assert from 'node:assert/strict';
import { CodefallFace } from '../src/codefall-face.js';
import { createFakePlatform } from './helpers/fake-platform.js';

class FakeAdapter extends EventTarget {
  constructor() {
    super();
    this.name = 'local';
    this.destroyCalls = 0;
    this.muted = false;
  }
  async init() { return this; }
  async speak() {}
  async startListening() {}
  async stopListening() {}
  interrupt() {}
  setMuted(value) { this.muted = value; }
  destroy() { this.destroyCalls++; }
}

class FakeRenderer {
  constructor() {
    this.theme = { name: 'wintermute' };
    this.quality = 'high';
    this.fps = 60;
    this.renderCalls = [];
    this.resizeCalls = 0;
    this.destroyCalls = 0;
  }
  render(dt, frame) { this.renderCalls.push({ dt, frame }); }
  resize() { this.resizeCalls++; }
  setTheme(name) { this.theme = { name: name === 'wintermute' ? name : 'codefall' }; }
  invalidateGeometry() {}
  setQuality(value) { this.quality = value === 'auto' ? 'high' : value; }
  destroy() { this.destroyCalls++; }
}

function createContainer(id = 'embed') {
  return {
    id,
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); },
  };
}

async function createFace(options = {}) {
  const platform = createFakePlatform();
  const container = createContainer(options.id);
  let renderer;
  const face = new CodefallFace(container, {
    provider: 'local',
    face: { seed: 7, bootDuration: 1 },
  }, {
    platform,
    rendererFactory(canvas, model, config) {
      renderer = new FakeRenderer(canvas, model, config);
      return renderer;
    },
    providerFactories: { local: FakeAdapter },
  });
  await face.ready;
  return { face, platform, container, renderer };
}

test('constructor owns one animation frame and one resize listener', async () => {
  const { face, platform, renderer } = await createFace();
  assert.deepEqual(platform.clock.pending(), { timers: 0, animationFrames: 1 });
  assert.equal(platform.listenerCount(platform.window, 'resize'), 1);
  platform.clock.advance(16);
  assert.equal(renderer.renderCalls.length, 1);
  assert.deepEqual(platform.clock.pending(), { timers: 0, animationFrames: 1 });
  face.destroy();
});

test('visibility pauses rendering and resumes without a delta spike', async () => {
  const { face, platform, renderer } = await createFace();
  platform.clock.advance(16);
  platform.setHidden(true);
  platform.clock.advance(1000);
  assert.equal(renderer.renderCalls.length, 1);
  platform.setHidden(false);
  platform.clock.advance(16);
  assert.equal(renderer.renderCalls.length, 2);
  assert.ok(renderer.renderCalls.at(-1).dt <= 0.1);
  face.destroy();
});

test('pause and resume preserve a live state', async () => {
  const { face } = await createFace();
  face._setState('listening');
  assert.equal(face.pause(), true);
  assert.equal(face.state, 'paused');
  assert.equal(face.resume(), true);
  assert.equal(face.state, 'listening');
  face.destroy();
});

test('on returns an unsubscribe function', async () => {
  const { face } = await createFace();
  let calls = 0;
  const unsubscribe = face.on('emotion', () => calls++);
  face.setEmotion('joy');
  unsubscribe();
  face.setEmotion('anger');
  assert.equal(calls, 1);
  face.destroy();
});

test('destroy removes owned resources and is idempotent', async () => {
  const { face, platform, renderer } = await createFace();
  const adapter = face.adapter;
  assert.equal(face.destroy(), true);
  assert.equal(face.destroy(), false);
  assert.deepEqual(platform.clock.pending(), { timers: 0, animationFrames: 0 });
  assert.equal(platform.listenerCount(platform.window, 'resize'), 0);
  assert.equal(platform.listenerCount(platform.document, 'visibilitychange'), 0);
  assert.equal(adapter.destroyCalls, 1);
  assert.equal(renderer.destroyCalls, 1);
  assert.equal(face.canvas.removed, true);
});

test('destroy is safe before provider readiness', async () => {
  let release;
  class SlowAdapter extends FakeAdapter {
    async init() { await new Promise((resolve) => { release = resolve; }); }
  }
  const platform = createFakePlatform();
  const face = new CodefallFace(createContainer(), {
    provider: 'local',
    face: { seed: 7 },
  }, {
    platform,
    rendererFactory: () => new FakeRenderer(),
    providerFactories: { local: SlowAdapter },
  });
  assert.equal(face.destroy(), true);
  release();
  await assert.doesNotReject(face.ready);
  assert.equal(face.adapter, null);
});

test('commands after destroy fail with a destroyed result', async () => {
  const { face } = await createFace();
  face.destroy();
  assert.equal(face.setEmotion('joy'), false);
  await assert.rejects(face.speak('still there?'), /destroyed/i);
});

test('embedded instances write presentation state to their own container', async () => {
  const { face, container, platform } = await createFace({ id: 'secondary-face' });
  face.setTheme('codefall');
  face.setGeometry('smooth');
  assert.equal(container.dataset.theme, 'codefall');
  assert.equal(container.dataset.geometry, 'smooth');
  assert.equal(platform.document.body.dataset.theme, undefined);
  face.destroy();
});
