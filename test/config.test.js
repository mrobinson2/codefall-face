import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';

test('wintermute is the default face theme', () => {
  assert.equal(resolveConfig().face.theme, 'wintermute');
});

test('codefall remains selectable', () => {
  assert.equal(resolveConfig({ face: { theme: 'codefall' } }).face.theme, 'codefall');
});

test('chiseled geometry is the default', () => {
  assert.equal(resolveConfig().face.geometry, 'chiseled');
});

test('smooth geometry remains configurable', () => {
  assert.equal(
    resolveConfig({ face: { geometry: 'smooth' } }).face.geometry,
    'smooth',
  );
});
