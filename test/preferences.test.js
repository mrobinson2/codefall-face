import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES, loadPreferences, savePreferences, clearPreferences,
} from '../src/ui/preferences.js';

function storage(initial = null, failing = false) {
  let value = initial;
  return {
    getItem() { if (failing) throw new Error('blocked'); return value; },
    setItem(_key, next) { if (failing) throw new Error('blocked'); value = next; },
    removeItem() { if (failing) throw new Error('blocked'); value = null; },
    value: () => value,
  };
}

test('missing corrupt and mismatched preferences normalize to defaults', () => {
  assert.deepEqual(loadPreferences(storage()).value, DEFAULT_PREFERENCES);
  assert.deepEqual(loadPreferences(storage('{bad')).value, DEFAULT_PREFERENCES);
  assert.deepEqual(loadPreferences(storage(JSON.stringify({ version: 2, theme: 'codefall' }))).value,
    DEFAULT_PREFERENCES);
});

test('partial preferences retain valid presentation values only', () => {
  const loaded = loadPreferences(storage(JSON.stringify({
    version: 1,
    theme: 'codefall',
    geometry: 'wrong',
    quality: 'low',
    motion: 'reduce',
    visualIntensity: 4,
    dock: 'left',
    collapsed: true,
    transcript: 'secret',
    apiKey: 'never store this',
  }))).value;
  assert.deepEqual(loaded, {
    ...DEFAULT_PREFERENCES,
    theme: 'codefall', quality: 'low', motion: 'reduce', dock: 'left', collapsed: true,
  });
  assert.equal('transcript' in loaded, false);
  assert.equal('apiKey' in loaded, false);
});

test('save writes only normalized versioned presentation data', () => {
  const target = storage();
  const result = savePreferences(target, {
    ...DEFAULT_PREFERENCES,
    theme: 'codefall',
    message: 'private words',
    provider: { key: 'credential' },
  });
  assert.equal(result.ok, true);
  const saved = JSON.parse(target.value());
  assert.equal(saved.theme, 'codefall');
  assert.equal(saved.version, 1);
  assert.equal('message' in saved, false);
  assert.equal('provider' in saved, false);
});

test('storage failures and reset never throw', () => {
  assert.equal(loadPreferences(storage(null, true)).ok, false);
  assert.equal(savePreferences(storage(null, true), DEFAULT_PREFERENCES).ok, false);
  assert.equal(clearPreferences(storage(null, true)).ok, false);
  const target = storage(JSON.stringify(DEFAULT_PREFERENCES));
  assert.equal(clearPreferences(target).ok, true);
  assert.equal(target.value(), null);
});
