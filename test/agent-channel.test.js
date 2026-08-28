import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentCommand } from '../src/agent/commands.js';
import { AgentChannel } from '../src/agent/agent-channel.js';
import { createFakePlatform } from './helpers/fake-platform.js';

const validCommands = [
  { type: 'speak', text: 'hello', emotion: 'joy' },
  { type: 'ask', text: 'who are you?' },
  { type: 'emotion', emotion: 'anger' },
  { type: 'listen', on: true },
  { type: 'interrupt' },
  { type: 'mute', muted: false },
  { type: 'theme', theme: 'wintermute' },
  { type: 'geometry', geometry: 'chiseled' },
  { type: 'quality', quality: 'medium' },
  { type: 'visual-intensity', value: 0.7 },
];

test('agent parser accepts every documented command', () => {
  for (const command of validCommands) {
    assert.deepEqual(parseAgentCommand(JSON.stringify(command)), { ok: true, command });
  }
});

test('agent parser returns stable errors without echoing raw input', () => {
  const cases = [
    ['{secret', 'bad-json'],
    ['null', 'bad-shape'],
    ['[]', 'bad-shape'],
    [JSON.stringify({ type: 'erase-world' }), 'unknown-command'],
    [JSON.stringify({ type: 'ask' }), 'invalid-field'],
    [JSON.stringify({ type: 'mute', muted: 'yes' }), 'invalid-field'],
    [JSON.stringify({ type: 'interrupt', surprise: true }), 'invalid-field'],
    [JSON.stringify({ type: 'theme', theme: 'pink' }), 'invalid-field'],
  ];
  for (const [raw, code] of cases) {
    const result = parseAgentCommand(raw);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(result.message.includes(raw), false);
  }
});

test('agent parser enforces raw and string size limits', () => {
  assert.equal(parseAgentCommand('x'.repeat(65537)).code, 'message-too-large');
  const long = JSON.stringify({ type: 'ask', text: 'x'.repeat(16385) });
  assert.equal(parseAgentCommand(long).code, 'invalid-field');
});

function setup(random = () => 0) {
  const platform = createFakePlatform();
  const commands = [];
  let snapshot = { lifecycle: 'idle', sequence: 1 };
  const channel = new AgentChannel({
    platform,
    random,
    dispatchCommand: (command) => commands.push(command),
    getSnapshot: () => snapshot,
  });
  return { platform, commands, channel, setSnapshot(value) { snapshot = value; } };
}

test('channel normalizes a path and sends a hello snapshot', () => {
  const { channel, platform } = setup();
  channel.attach('/agent-hub');
  const socket = platform.sockets[0];
  assert.equal(socket.url, 'ws://example.test/agent-hub');
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: 'hello', client: 'codefall-face', snapshot: { lifecycle: 'idle', sequence: 1 },
  });
  channel.destroy();
});

test('channel validates commands and forwards live events', () => {
  const { channel, platform, commands } = setup();
  channel.attach('wss://agent.test/control');
  const socket = platform.sockets[0];
  socket.open();
  socket.message(JSON.stringify({ type: 'geometry', geometry: 'smooth' }));
  socket.message('{bad');
  channel.publish('emotion', { emotion: 'fear' });
  assert.deepEqual(commands, [{ type: 'geometry', geometry: 'smooth' }]);
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'emotion', emotion: 'fear' });
  channel.destroy();
});

test('reconnect uses capped exponential backoff and resets after stability', () => {
  const { channel, platform } = setup();
  channel.attach('/hub');
  const delays = [];
  for (let i = 0; i < 5; i++) {
    const socket = platform.sockets.at(-1);
    socket.open();
    socket.close();
    const timer = platform.clock.nextTimer();
    delays.push(timer.time - platform.clock.now);
    platform.clock.advance(delays.at(-1));
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000]);
  const stable = platform.sockets.at(-1);
  stable.open();
  platform.clock.advance(10000);
  stable.close();
  assert.equal(platform.clock.nextTimer().time - platform.clock.now, 1000);
  channel.destroy();
});

test('disconnected publishing buffers only the latest snapshot', () => {
  const { channel, platform, setSnapshot } = setup();
  channel.attach('/hub', { reconnect: false });
  setSnapshot({ lifecycle: 'thinking', sequence: 2 });
  channel.publish('state', { state: 'thinking' });
  setSnapshot({ lifecycle: 'speaking', sequence: 3 });
  channel.publish('state', { state: 'speaking' });
  const socket = platform.sockets[0];
  socket.open();
  assert.deepEqual(socket.sent.map(JSON.parse), [
    { type: 'hello', client: 'codefall-face', snapshot: { lifecycle: 'speaking', sequence: 3 } },
    { type: 'snapshot', snapshot: { lifecycle: 'speaking', sequence: 3 } },
  ]);
  channel.destroy();
});

test('detach and destroy prevent reconnect', () => {
  const { channel, platform } = setup();
  channel.attach('/hub');
  const first = platform.sockets[0];
  channel.detach();
  first.close();
  platform.clock.advance(30000);
  assert.equal(platform.sockets.length, 1);
  channel.attach('/hub');
  const second = platform.sockets[1];
  channel.destroy();
  second.close();
  platform.clock.advance(30000);
  assert.equal(platform.sockets.length, 2);
  assert.equal(channel.getSnapshot().status, 'destroyed');
});
