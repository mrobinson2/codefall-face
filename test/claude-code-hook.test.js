import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeTranscript, mapHookEvent, runHook,
} from '../integrations/claude-code/face-hook.mjs';

function transcript(lines) {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

const SAMPLE_TRANSCRIPT = transcript([
  { type: 'user', message: { role: 'user', content: 'fix the build' } },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Looking at the failure now.' }],
    },
  },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: '## Fixed\n\nThe build passes now. I changed `retry()` to use **exponential backoff**:\n\n```js\nfor (let i = 0; i < 3; i++) retry();\n```\n\nSee [the docs](https://example.test) for details.' },
      ],
    },
  },
]);

test('summarizeTranscript returns the last assistant text stripped of markdown and code', () => {
  const summary = summarizeTranscript(SAMPLE_TRANSCRIPT, 280);
  assert.match(summary, /The build passes now/);
  assert.match(summary, /exponential backoff/);
  assert.doesNotMatch(summary, /```/);
  assert.doesNotMatch(summary, /for \(let i/);
  assert.doesNotMatch(summary, /##/);
  assert.doesNotMatch(summary, /\*\*/);
  assert.doesNotMatch(summary, /https:\/\/example\.test/);
  assert.match(summary, /the docs/);
});

test('summarizeTranscript clamps long output and handles empty or malformed input', () => {
  const long = transcript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'word '.repeat(200) }] } },
  ]);
  const clamped = summarizeTranscript(long, 80);
  assert.ok(clamped.length <= 81, `length ${clamped.length}`);
  assert.match(clamped, /…$/);
  assert.equal(summarizeTranscript('', 280), null);
  assert.equal(summarizeTranscript('not json at all\n{broken', 280), null);
  assert.equal(summarizeTranscript(transcript([{ type: 'user', message: { role: 'user', content: 'hi' } }]), 280), null);
});

test('UserPromptSubmit maps to a focus emotion', () => {
  const commands = mapHookEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'do things' }, {});
  assert.deepEqual(commands, [{ path: '/api/face/command', body: { type: 'emotion', emotion: 'focus' } }]);
});

test('Stop speaks the transcript summary by default', () => {
  const commands = mapHookEvent(
    { hook_event_name: 'Stop', transcript_path: '/tmp/t.jsonl' },
    { readFile: () => SAMPLE_TRANSCRIPT },
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].path, '/api/face/say');
  assert.match(commands[0].body.text, /build passes/);
});

test('Stop in status mode speaks a fixed phrase and in off mode stays silent but emotes', () => {
  const status = mapHookEvent(
    { hook_event_name: 'Stop', transcript_path: '/tmp/t.jsonl' },
    { mode: 'status', readFile: () => SAMPLE_TRANSCRIPT },
  );
  assert.equal(status[0].path, '/api/face/say');
  assert.equal(status[0].body.text, 'Done.');

  const off = mapHookEvent(
    { hook_event_name: 'Stop', transcript_path: '/tmp/t.jsonl' },
    { mode: 'off', readFile: () => SAMPLE_TRANSCRIPT },
  );
  assert.deepEqual(off, [{ path: '/api/face/command', body: { type: 'emotion', emotion: 'neutral' } }]);
});

test('Stop with an unreadable or empty transcript falls back to a fixed phrase', () => {
  const commands = mapHookEvent(
    { hook_event_name: 'Stop', transcript_path: '/tmp/missing.jsonl' },
    { readFile: () => { throw new Error('ENOENT'); } },
  );
  assert.equal(commands[0].body.text, 'Done.');
});

test('Notification speaks the message with an alert emotion', () => {
  const commands = mapHookEvent(
    { hook_event_name: 'Notification', message: 'Claude needs permission to run npm test' },
    {},
  );
  assert.equal(commands[0].path, '/api/face/say');
  assert.match(commands[0].body.text, /needs permission/);
  assert.equal(commands[0].body.emotion, 'alert');
});

test('unknown events and off-mode notifications produce no speech commands', () => {
  assert.deepEqual(mapHookEvent({ hook_event_name: 'PreCompact' }, {}), []);
  const off = mapHookEvent({ hook_event_name: 'Notification', message: 'hi' }, { mode: 'off' });
  assert.equal(off.every((c) => c.path !== '/api/face/say'), true);
});

test('Codex agent-turn-complete notifications speak the last assistant message', () => {
  const commands = mapHookEvent(
    { type: 'agent-turn-complete', 'last-assistant-message': 'Refactor **done**, `npm test` is green.' },
    {},
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].path, '/api/face/say');
  assert.match(commands[0].body.text, /Refactor done/);
  assert.doesNotMatch(commands[0].body.text, /\*\*/);
});

test('Codex notifications respect status and off modes and ignore unknown types', () => {
  const payload = { type: 'agent-turn-complete', 'last-assistant-message': 'details' };
  assert.equal(mapHookEvent(payload, { mode: 'status' })[0].body.text, 'Done.');
  const off = mapHookEvent(payload, { mode: 'off' });
  assert.deepEqual(off, [{ path: '/api/face/command', body: { type: 'emotion', emotion: 'neutral' } }]);
  assert.deepEqual(mapHookEvent({ type: 'session-configured' }, {}), []);
});

test('Codex agent-turn-complete without a message falls back to a fixed phrase', () => {
  const commands = mapHookEvent({ type: 'agent-turn-complete' }, {});
  assert.equal(commands[0].body.text, 'Done.');
});

test('runHook posts mapped commands with auth and always succeeds', async () => {
  const calls = [];
  const code = await runHook({
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }),
    env: { CODEFALL_FACE_URL: 'http://face.test', FACE_HUB_TOKEN: 'tok' },
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, async json() { return { delivered: 1 }; } }; },
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://face.test/api/face/command');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('runHook survives malformed stdin and an unreachable face server', async () => {
  assert.equal(await runHook({ input: '{nope', env: {}, fetchImpl: async () => { throw new Error('no'); } }), 0);
  assert.equal(await runHook({
    input: JSON.stringify({ hook_event_name: 'Notification', message: 'x' }),
    env: {},
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  }), 0);
});
