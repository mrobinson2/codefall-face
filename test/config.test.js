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

test('visual intensity defaults and clamps finite values', () => {
  assert.equal(resolveConfig().face.visualIntensity, 0.65);
  assert.equal(resolveConfig({ face: { visualIntensity: -2 } }).face.visualIntensity, 0);
  assert.equal(resolveConfig({ face: { visualIntensity: 3 } }).face.visualIntensity, 1);
});

test('invalid visual intensity falls back with a diagnostic', () => {
  for (const value of ['high', Number.NaN, Number.POSITIVE_INFINITY]) {
    const config = resolveConfig({ face: { visualIntensity: value } });
    assert.equal(config.face.visualIntensity, 0.65);
    assert.equal(config.diagnostics.at(-1).code, 'invalid-visual-intensity');
  }
});

test('seed accepts null or unsigned 32-bit integers only', () => {
  assert.equal(resolveConfig().face.seed, null);
  assert.equal(resolveConfig({ face: { seed: 4294967295 } }).face.seed, 4294967295);
  for (const seed of [-1, 1.2, 4294967296, '7']) {
    const config = resolveConfig({ face: { seed } });
    assert.equal(config.face.seed, null);
    assert.equal(config.diagnostics.at(-1).code, 'invalid-seed');
  }
});
