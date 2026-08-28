import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceStateMachine } from '../src/runtime/state-machine.js';

test('booting reaches idle but cannot jump to interrupted', () => {
  const machine = new FaceStateMachine();
  const diagnostics = [];
  machine.addEventListener('diagnostic', (event) => diagnostics.push(event.detail));
  assert.equal(machine.transition('interrupted'), false);
  assert.equal(machine.state, 'booting');
  assert.equal(diagnostics[0].code, 'invalid-transition');
  assert.equal(machine.transition('idle'), true);
  assert.equal(machine.state, 'idle');
});

test('conversation states follow idle listening thinking speaking idle', () => {
  const machine = new FaceStateMachine('idle');
  const seen = [];
  machine.addEventListener('change', (event) => seen.push(event.detail.state));
  for (const state of ['listening', 'thinking', 'speaking', 'idle']) {
    assert.equal(machine.transition(state), true);
  }
  assert.deepEqual(seen, ['listening', 'thinking', 'speaking', 'idle']);
});

test('interrupted state explicitly recovers to idle', () => {
  const machine = new FaceStateMachine('speaking');
  assert.equal(machine.transition('interrupted'), true);
  assert.equal(machine.transition('idle'), true);
  assert.equal(machine.state, 'idle');
});

test('pause remembers and restores the prior live state', () => {
  const machine = new FaceStateMachine('listening');
  assert.equal(machine.pause(), true);
  assert.equal(machine.state, 'paused');
  assert.equal(machine.resume(), true);
  assert.equal(machine.state, 'listening');
});

test('destroy is terminal and idempotent', () => {
  const machine = new FaceStateMachine('idle');
  assert.equal(machine.destroy(), true);
  assert.equal(machine.destroy(), false);
  assert.equal(machine.transition('idle'), false);
  assert.equal(machine.state, 'destroyed');
});

test('same-state transitions have no event side effects', () => {
  const machine = new FaceStateMachine('idle');
  let changes = 0;
  machine.addEventListener('change', () => changes++);
  assert.equal(machine.transition('idle'), false);
  assert.equal(changes, 0);
});
