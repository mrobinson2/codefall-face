import test from 'node:test';
import assert from 'node:assert/strict';
import * as rendererHelpers from '../src/face/renderer.js';

const {
  CodefallRenderer, ringSegments, rowOffset, shouldRefreshWintermuteGlyph,
} = rendererHelpers;

test('wintermute ring keeps a large right-side gap', () => {
  const arcs = ringSegments(0, true, 0);
  assert.equal(arcs.length, 2);
  assert.ok(arcs[0].end < arcs[1].start);
  assert.ok(arcs[0].start > 0);
  assert.ok(arcs[1].end < Math.PI * 2);
});

test('wintermute breach widens the combined right-side gap', () => {
  const closed = ringSegments(0, true, 0);
  const breached = ringSegments(0, true, 1);
  const rightGap = (arcs) => arcs[0].start + Math.PI * 2 - arcs[1].end;
  assert.ok(rightGap(breached) > rightGap(closed));
});

test('codefall breach shrinks both halo spans while keeping them positive', () => {
  assert.equal(typeof rendererHelpers.codefallRingSpans, 'function');
  const stable = rendererHelpers.codefallRingSpans(0);
  const partial = rendererHelpers.codefallRingSpans(0.5);
  const breached = rendererHelpers.codefallRingSpans(1);
  assert.equal(stable.length, 2);
  for (let i = 0; i < stable.length; i++) {
    assert.ok(stable[i] > partial[i]);
    assert.ok(partial[i] > breached[i]);
    assert.ok(breached[i] > 0);
  }
});

test('possession aperture hardware uses fixed cold cyan', () => {
  assert.equal(typeof rendererHelpers.apertureHardwareStroke, 'function');
  assert.equal(
    rendererHelpers.apertureHardwareStroke(0.64),
    'hsla(190, 90%, 72%, 0.64)',
  );
});

test('rowOffset returns zero outside active bands', () => {
  assert.equal(rowOffset(12, { active: true, envelope: 1, bands: [
    { start: 3, height: 4, offset: 5 },
  ] }), 0);
});

test('rowOffset scales a matching band by its envelope', () => {
  assert.equal(rowOffset(5, { active: true, envelope: 0.5, bands: [
    { start: 3, height: 4, offset: 6 },
  ] }), 3);
});

test('overlapping bands cannot shift more than twelve cells', () => {
  assert.equal(rowOffset(5, { active: true, envelope: 1, bands: [
    { start: 2, height: 8, offset: 9 },
    { start: 4, height: 3, offset: 9 },
  ] }), 12);
});

test('wintermute dirty refresh includes every non-void cell only', () => {
  assert.equal(shouldRefreshWintermuteGlyph(true, 'wintermute', 1), true);
  assert.equal(shouldRefreshWintermuteGlyph(true, 'wintermute', 0), false);
  assert.equal(shouldRefreshWintermuteGlyph(false, 'wintermute', 1), false);
  assert.equal(shouldRefreshWintermuteGlyph(true, 'codefall', 1), false);
});

test('switching themes marks wintermute glyphs dirty immediately', () => {
  const renderer = Object.create(CodefallRenderer.prototype);
  renderer.buildAtlas = () => {};
  renderer.setTheme('wintermute');
  assert.equal(renderer._wintermuteGlyphsDirty, true);
  renderer.setTheme('codefall');
  assert.equal(renderer._wintermuteGlyphsDirty, false);
});

test('geometry invalidation refreshes wintermute glyphs only', () => {
  const renderer = Object.create(CodefallRenderer.prototype);
  renderer.theme = { name: 'wintermute' };
  renderer._wintermuteGlyphsDirty = false;
  renderer.invalidateGeometry();
  assert.equal(renderer._wintermuteGlyphsDirty, true);

  renderer.theme = { name: 'codefall' };
  renderer._wintermuteGlyphsDirty = false;
  renderer.invalidateGeometry();
  assert.equal(renderer._wintermuteGlyphsDirty, false);
});

test('quality tiers cap debris', () => {
  assert.deepEqual(
    ['high', 'medium', 'low'].map(rendererHelpers.debrisLimit),
    [120, 72, 36],
  );
});
