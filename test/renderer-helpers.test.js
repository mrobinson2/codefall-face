import test from 'node:test';
import assert from 'node:assert/strict';
import { ringSegments, rowOffset } from '../src/face/renderer.js';

test('wintermute ring keeps a large right-side gap', () => {
  const arcs = ringSegments(0, true, 0);
  assert.equal(arcs.length, 2);
  assert.ok(arcs[0].end - arcs[0].start < Math.PI * 1.8);
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
