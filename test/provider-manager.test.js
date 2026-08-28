import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderManager } from '../src/voice/provider-manager.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeAdapter extends EventTarget {
  constructor(name, init = Promise.resolve()) {
    super();
    this.name = name;
    this.initResult = init;
    this.destroyCalls = 0;
    this.capabilities = {
      tts: true,
      stt: name !== 'local',
      conversational: name === 'lacy',
      waveform: name !== 'local',
      retry: true,
    };
  }
  async init() { await this.initResult; return this; }
  destroy() { this.destroyCalls++; }
}

function factory(name, queue, created) {
  return class extends FakeAdapter {
    constructor() {
      const next = queue.shift() || Promise.resolve();
      super(name, next);
      created.push(this);
    }
  };
}

function setup(sequences = {}) {
  const created = { azure: [], piper: [], lacy: [], local: [] };
  const factories = {};
  for (const name of Object.keys(created)) {
    factories[name] = factory(name, [...(sequences[name] || [])], created[name]);
  }
  return { manager: new ProviderManager({ config: {}, factories }), created };
}

test('auto mode tries azure then piper then local', async () => {
  const unavailable = Object.assign(new Error('offline'), { kind: 'unavailable' });
  const { manager, created } = setup({
    azure: [Promise.reject(unavailable)],
    piper: [Promise.reject(unavailable)],
  });
  const adapter = await manager.start('auto');
  assert.equal(adapter.name, 'local');
  assert.deepEqual(created.azure.map((item) => item.destroyCalls), [1]);
  assert.deepEqual(created.piper.map((item) => item.destroyCalls), [1]);
  assert.equal(manager.getSnapshot().status, 'ready');
  manager.destroy();
});

test('explicit provider failure is normalized and fatal', async () => {
  const { manager } = setup({ azure: [Promise.reject(new Error('relay refused'))] });
  await assert.rejects(manager.start('azure'), /relay refused/);
  assert.deepEqual(manager.getSnapshot().error, {
    kind: 'fatal', provider: 'azure', message: 'relay refused', cause: manager.getSnapshot().error.cause,
  });
  assert.equal(manager.getSnapshot().status, 'fatal-error');
});

test('recoverable failures can retry while user denial cannot', async () => {
  const recoverable = Object.assign(new Error('temporary'), { kind: 'recoverable' });
  const denied = Object.assign(new Error('microphone denied'), { name: 'NotAllowedError' });
  const first = setup({ azure: [Promise.reject(recoverable), Promise.resolve()] });
  await assert.rejects(first.manager.start('azure'));
  assert.equal(first.manager.getSnapshot().status, 'recoverable-error');
  assert.equal((await first.manager.retry()).name, 'azure');
  const second = setup({ local: [Promise.reject(denied)] });
  await assert.rejects(second.manager.start('local'));
  assert.equal(second.manager.getSnapshot().error.kind, 'user-denied');
  assert.equal(await second.manager.retry(), false);
});

test('ready emits normalized capabilities', async () => {
  const { manager } = setup();
  let detail;
  manager.addEventListener('capabilities', (event) => { detail = event.detail; });
  await manager.start('lacy');
  assert.deepEqual(detail, {
    tts: true, stt: true, conversational: true, waveform: true, retry: true,
  });
});

test('stale initialization is disposed and cannot replace the winner', async () => {
  const slow = deferred();
  const { manager, created } = setup({ azure: [slow.promise] });
  const stale = manager.start('azure');
  const winner = await manager.switchTo('local');
  slow.resolve();
  assert.equal(await stale, null);
  assert.equal(winner, manager.adapter);
  assert.equal(manager.adapter.name, 'local');
  assert.equal(created.azure[0].destroyCalls, 1);
  manager.destroy();
});

test('active adapter stays live until its replacement is viable', async () => {
  const slow = deferred();
  const { manager, created } = setup({ lacy: [slow.promise] });
  await manager.start('local');
  const switching = manager.switchTo('lacy');
  assert.equal(created.local[0].destroyCalls, 0);
  assert.equal(manager.adapter.name, 'local');
  slow.resolve();
  await switching;
  assert.equal(created.local[0].destroyCalls, 1);
  assert.equal(manager.adapter.name, 'lacy');
  manager.destroy();
});

test('destroy during initialization disposes pending work and is idempotent', async () => {
  const slow = deferred();
  const { manager, created } = setup({ azure: [slow.promise] });
  const starting = manager.start('azure');
  assert.equal(manager.destroy(), true);
  assert.equal(manager.destroy(), false);
  assert.equal(created.azure[0].destroyCalls, 1);
  slow.resolve();
  assert.equal(await starting, null);
  assert.equal(manager.getSnapshot().status, 'destroyed');
});
