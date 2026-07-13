import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FaceModel,
  headHalfWidth,
  classifyFaceMaterial,
  smoothHeadDistance,
} from '../src/face/face-model.js';
import { MATERIAL, REGION } from '../src/face/glyphs.js';

test('head width creates temple, cheek, jaw, and chin breaks', () => {
  const temple = headHalfWidth(-0.55, 0, 0.5);
  const cheek = headHalfWidth(-0.08, 0, 0.5);
  const jaw = headHalfWidth(0.48, 0, 0.5);
  const chin = headHalfWidth(0.96, 0, 0.5);
  assert.ok(cheek > temple);
  assert.ok(jaw < cheek);
  assert.ok(chin < jaw);
});

test('head width preserves every planned silhouette breakpoint', () => {
  const mouthOpen = 0.8;
  const jawSharp = 0.5;
  const breakpoints = [
    [-0.82, 0.42],
    [-0.55, 0.52],
    [-0.08, 0.62],
    [0.38, 0.48 + jawSharp * 0.035],
    [0.68, 0.34],
    [1.0 + mouthOpen * 0.05, 0.09],
  ];
  for (const [v, width] of breakpoints) {
    assert.ok(Math.abs(headHalfWidth(v, mouthOpen, jawSharp) - width) < 1e-12);
  }
});

test('head width keeps aggregate allocation out of the hot helper', () => {
  assert.doesNotMatch(headHalfWidth.toString(), /(?:=\s*\[|new\s+Array\s*\()/);
});

test('eye and mouth anatomy receives fine material', () => {
  assert.equal(classifyFaceMaterial(0.2, -0.16, 0.3, REGION.EYE), MATERIAL.FINE);
  assert.equal(classifyFaceMaterial(0.1, 0.55, 0.3, REGION.MOUTH), MATERIAL.FINE);
});

test('temple port receives aperture material', () => {
  assert.equal(classifyFaceMaterial(0.49, 0.12, 0.9, REGION.FACE), MATERIAL.APERTURE);
});

test('smooth geometry has a rounded temple and tapered jaw', () => {
  assert.ok(smoothHeadDistance(0.5, -0.45, 0, 0.5) < 0);
  assert.ok(smoothHeadDistance(0.5, 0.72, 0, 0.5) > 0);
});

test('FaceModel accepts only known geometry styles', () => {
  const model = new FaceModel('chiseled');
  assert.equal(model.setGeometry('smooth'), 'smooth');
  assert.equal(model.geometry, 'smooth');
  assert.equal(model.setGeometry('wireframe'), 'smooth');
});

test('both head geometry helpers avoid per-call arrays', () => {
  const aggregate = /(?:=\s*\[|new\s+Array\s*\()/;
  assert.doesNotMatch(smoothHeadDistance.toString(), aggregate);
  assert.doesNotMatch(headHalfWidth.toString(), aggregate);
});
