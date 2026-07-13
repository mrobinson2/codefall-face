import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';

test('wintermute is the default face theme', () => {
  assert.equal(resolveConfig().face.theme, 'wintermute');
});

test('codefall remains selectable', () => {
  assert.equal(resolveConfig({ face: { theme: 'codefall' } }).face.theme, 'codefall');
});
