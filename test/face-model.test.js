import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FaceModel,
  headHalfWidth,
  classifyFaceMaterial,
  smoothHeadDistance,
} from '../src/face/face-model.js';
import { MATERIAL, REGION } from '../src/face/glyphs.js';
import { EMOTIONS, NEUTRAL } from '../src/face/emotions.js';

function makeModel(geometry = 'chiseled') {
  const model = new FaceModel(geometry);
  const grid = {
    cols: 60, rows: 60, cellW: 4, cellH: 4, width: 240, height: 240,
  };
  model.setGrid(grid);
  return { model, grid };
}

function makeBuffers(grid) {
  const length = grid.cols * grid.rows;
  return {
    bright: new Float32Array(length),
    region: new Uint8Array(length),
    sdf: new Float32Array(length),
    material: new Uint8Array(length),
  };
}

function dynamics(overrides = {}) {
  return {
    mouthOpen: 0,
    mouthWide: 0,
    tension: 0,
    energy: 0,
    blink: 1,
    gazeX: 0,
    gazeY: 0,
    coherence: 1,
    swayX: 0,
    swayY: 0,
    t: 0,
    ...overrides,
  };
}

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

test('eye positions follow gaze and blink scales their glow', () => {
  const { model } = makeModel();
  const centered = model.eyePositions(NEUTRAL, dynamics());
  const shifted = model.eyePositions(NEUTRAL, dynamics({ gazeX: 1, gazeY: -0.5 }));
  const blink = model.eyePositions(NEUTRAL, dynamics({ blink: 0.2 }));

  for (let i = 0; i < centered.length; i++) {
    assert.ok(shifted[i].x > centered[i].x);
    assert.ok(shifted[i].y < centered[i].y);
    assert.ok(Math.abs(blink[i].glow - centered[i].glow * 0.2) < 1e-12);
  }
});

test('open speech creates bright lips around a dark inner mouth cavity', () => {
  const { model, grid } = makeModel();
  const buffers = makeBuffers(grid);
  model.fill(
    buffers.bright,
    buffers.region,
    buffers.sdf,
    buffers.material,
    NEUTRAL,
    dynamics({ mouthOpen: 1, mouthWide: 1, energy: 0.8 }),
  );

  const values = (target) => Array.from(buffers.bright).filter(
    (_, index) => buffers.region[index] === target,
  );
  const lips = values(REGION.MOUTH);
  const cavity = values(REGION.MOUTH_INNER);
  const eyes = values(REGION.EYE);
  const average = (items) => items.reduce((sum, value) => sum + value, 0) / items.length;

  assert.ok(lips.length > 0);
  assert.ok(cavity.length > 0);
  assert.ok(eyes.length > 0);
  assert.ok(average(cavity) < average(lips));
  assert.ok(average(cavity) < average(eyes));
  for (let i = 0; i < buffers.region.length; i++) {
    if (buffers.region[i] === REGION.MOUTH) assert.equal(buffers.material[i], MATERIAL.FINE);
    if (buffers.region[i] === REGION.MOUTH_INNER) {
      assert.equal(buffers.material[i], MATERIAL.MACHINE);
    }
  }
});

test('low coherence and strong emotion retain finite nonempty face geometry', () => {
  const validRegions = new Set(Object.values(REGION));
  const validMaterials = new Set(Object.values(MATERIAL));
  const cases = [
    ['chiseled', NEUTRAL, dynamics({ coherence: 0.05, t: 9.25 })],
    ['smooth', EMOTIONS.anger, dynamics({ mouthOpen: 0.7, energy: 1, t: 4.5 })],
  ];

  for (const [geometry, emotion, dyn] of cases) {
    const { model, grid } = makeModel(geometry);
    const buffers = makeBuffers(grid);
    model.fill(
      buffers.bright,
      buffers.region,
      buffers.sdf,
      buffers.material,
      emotion,
      dyn,
    );

    assert.ok(Array.from(buffers.bright).every(Number.isFinite));
    assert.ok(Array.from(buffers.sdf).every(Number.isFinite));
    assert.ok(Array.from(buffers.region).every((value) => validRegions.has(value)));
    assert.ok(Array.from(buffers.material).every((value) => validMaterials.has(value)));
    assert.ok(Array.from(buffers.region).some((value) => value !== REGION.VOID));
    assert.ok(Array.from(buffers.sdf).some((value) => value <= 0));
  }
});
