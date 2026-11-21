import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { AzureVoiceLiveAdapter } from '../src/voice/azure-voice-live.js';

class Socket {
  static OPEN = 1;
  static latest;
  readyState = Socket.OPEN;
  sent = [];

  constructor() { Socket.latest = this; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

class Audio {
  static latest;
  state = 'suspended';
  currentTime = 0;
  sources = [];

  constructor() { Audio.latest = this; }
  destination = {};
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
  createBuffer(_channels, count, rate) {
    const data = new Float32Array(count);
    return { duration: count / rate, getChannelData: () => data };
  }
  createBufferSource() {
    const source = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; } };
    this.sources.push(source);
    return source;
  }
  audioWorklet = { addModule: async () => {} };
}

function setup(t) {
  for (const [name, value] of Object.entries({ WebSocket: Socket, window: { AudioContext: Audio } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  const adapter = new AzureVoiceLiveAdapter({
    azure: { relayUrl: 'ws://localhost/relay', voice: 'en-US-AndrewMultilingualNeural', instructions: 'Speak in character.' },
  });
  t.after(() => adapter.destroy());
  return adapter;
}

async function connect(adapter) {
  const ready = adapter.init();
  const socket = Socket.latest;
  socket.receive({ type: 'session.created' });
  socket.receive({ type: 'session.updated' });
  await ready;
  return socket;
}

test('voice readiness waits for Azure to acknowledge the session configuration', async t => {
  const adapter = setup(t);
  let ready = false;
  const initialized = adapter.init().then(() => { ready = true; });
  const socket = Socket.latest;
  socket.receive({ type: 'session.created' });
  await Promise.resolve();
  assert.equal(ready, false);
  const session = socket.sent[0].session;
  assert.equal(session.input_audio_format, 'pcm16');
  assert.equal(session.input_audio_sampling_rate, 24000);
  assert.equal(session.input_audio_transcription.model, 'whisper-1');
  assert.equal(session.turn_detection.create_response, true);
  socket.receive({ type: 'session.updated' });
  await initialized;
  assert.equal(ready, true);
  adapter.updateInstructions('A second scene.');
  assert.deepEqual(socket.sent.at(-1), { type: 'session.update', session: { instructions: 'A second scene.' } });
});

test('a text turn sends conversation input, resolves on text-only reply, and returns to idle', async t => {
  const adapter = setup(t);
  const socket = await connect(adapter);
  const transcripts = [];
  const states = [];
  adapter.addEventListener('statechange', event => states.push(event.detail.state));
  adapter.addEventListener('transcript', event => transcripts.push(event.detail));
  const answer = adapter.ask('What is behind the door?');
  assert.deepEqual(socket.sent.slice(-2).map(x => x.type), ['conversation.item.create', 'response.create']);
  assert.equal(socket.sent.at(-2).item.content[0].text, 'What is behind the door?');
  socket.receive({ type: 'response.created', response: { id: 'reply' } });
  socket.receive({ type: 'response.text.done', response_id: 'reply', text: 'A garden.' });
  socket.receive({ type: 'response.done', response: { id: 'reply', status: 'completed' } });
  await answer;
  assert.equal(transcripts.at(-1).text, 'A garden.');
  assert.equal(transcripts.at(-1).final, true);
  assert.equal(states.at(-1), 'idle');
});

test('interrupt stops audible PCM, truncates unheard output and ignores late chunks', async t => {
  const adapter = setup(t);
  const socket = await connect(adapter);
  await adapter.unlockAudio();
  const answer = adapter.ask('Hello.');
  socket.receive({ type: 'response.created', response: { id: 'reply' } });
  const chunk = {
    type: 'response.audio.delta', response_id: 'reply', item_id: 'voice', content_index: 0,
    delta: Buffer.from([0, 64, 0, 192]).toString('base64'),
  };
  socket.receive(chunk);
  assert.deepEqual([...Audio.latest.sources[0].buffer.getChannelData(0)], [0.5, -0.5]);
  adapter.interrupt();
  assert.equal(Audio.latest.sources[0].stopped, true);
  assert.deepEqual(socket.sent.slice(-2).map(x => x.type), ['response.cancel', 'conversation.item.truncate']);
  socket.receive(chunk);
  assert.equal(Audio.latest.sources.length, 1);
  await answer;
});

test('stopping microphone during a pending permission prompt releases the eventual stream', async t => {
  const adapter = setup(t);
  await connect(adapter);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let complete;
  let requests = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => { requests++; return new Promise(resolve => { complete = resolve; }); } } },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  const opening = adapter.startListening();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requests, 1);
  await adapter.stopListening();
  let stops = 0;
  complete({ getTracks: () => [{ stop() { stops++; } }] });
  await opening;
  assert.equal(stops, 1);
});

test('PCM worklet maintains 24 kHz sample rate across 44.1 kHz render blocks', async () => {
  const source = await readFile(new URL('../src/voice/azure-pcm-capture.js', import.meta.url), 'utf8');
  let Worklet;
  const packets = [];
  runInNewContext(source, {
    sampleRate: 44100,
    AudioWorkletProcessor: class { port = { postMessage(packet) { packets.push(packet); } }; },
    registerProcessor(_name, processor) { Worklet = processor; },
  });
  const worklet = new Worklet();
  const block = new Float32Array(100).fill(-0.5);
  for (let index = 0; index < 441; index += 1) worklet.process([[block]]);
  assert.equal(packets.length, 25);
  assert.equal(packets[0].byteLength, 1920);
  assert.equal(new DataView(packets[0]).getInt16(0, true), -16384);
});

test('a disconnected adapter settles the old turn and can establish another session', async t => {
  const adapter = setup(t);
  const socket = await connect(adapter);
  const answer = adapter.ask('Are you still there?');
  socket.onclose();
  await assert.rejects(answer, /disconnected/);
  assert.equal(socket.readyState, 3);
  const another = await connect(adapter);
  assert.notEqual(another, socket);
  assert.equal(another.sent[0].type, 'session.update');
});
