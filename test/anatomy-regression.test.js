import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceModel } from '../src/face/face-model.js';
import { SceneBuffers } from '../src/face/scene-buffers.js';
import { REGION } from '../src/face/glyphs.js';
import { NEUTRAL } from '../src/face/emotions.js';

const DYN = Object.freeze({
  mouthOpen: 0.82, mouthWide: 0.55, tension: 0.6, energy: 0.7,
  blink: 1, gazeX: 0, gazeY: 0, coherence: 1,
  swayX: 0, swayY: 0, t: 2.5,
});

function build(geometry, cols) {
  const rows = Math.round(cols * 1.2);
  const cellW = 4;
  const cellH = 4;
  const model = new FaceModel(geometry);
  model.setGrid({
    cols, rows, cellW, cellH, width: cols * cellW, height: rows * cellH,
  });
  const buffers = new SceneBuffers({ glyphRandom: () => 0.5, churnRandom: () => 0.5 });
  buffers.resize(cols, rows);
  model.fill(buffers, NEUTRAL, DYN);
  return { model, buffers, cols, rows };
}

function cells(scene, target) {
  const result = [];
  for (let i = 0; i < scene.buffers.region.length; i++) {
    if (scene.buffers.region[i] === target) result.push([i % scene.cols, (i / scene.cols) | 0, i]);
  }
  return result;
}

test('expanded cybernetic anatomy regions are exported', () => {
  for (const name of [
    'BROW_RIDGE', 'ORBIT', 'NOSE_PLANE', 'NOSTRIL', 'CHEEK_PLANE',
    'JAW_HINGE', 'CHIN_PLATE', 'TEMPLE_PORT', 'NECK_TENDON',
  ]) assert.equal(Number.isInteger(REGION[name]), true, name);
});

for (const geometry of ['chiseled', 'smooth']) {
  for (const size of [48, 60, 80]) {
    test(`${geometry} ${size}-column anatomy keeps bilateral landmarks and machine depth`, () => {
      const scene = build(geometry, size);
      const eyes = cells(scene, REGION.EYE);
      const orbits = cells(scene, REGION.ORBIT);
      const cheeks = cells(scene, REGION.CHEEK_PLANE);
      const hinges = cells(scene, REGION.JAW_HINGE);
      const nose = cells(scene, REGION.NOSE_PLANE);
      const nostrils = cells(scene, REGION.NOSTRIL);
      const lips = cells(scene, REGION.MOUTH);
      const cavity = cells(scene, REGION.MOUTH_INNER);
      const port = cells(scene, REGION.TEMPLE_PORT);
      const tendons = cells(scene, REGION.NECK_TENDON);
      const chin = cells(scene, REGION.CHIN_PLATE);

      const bilateral = (items) => {
        const left = items.filter(([x]) => x < scene.cols / 2).length;
        const right = items.length - left;
        assert.ok(left > 0 && right > 0);
        assert.ok(Math.abs(left - right) <= Math.max(2, scene.rows * 0.04));
      };
      bilateral(eyes);
      bilateral(orbits);
      bilateral(cheeks);
      bilateral(hinges);
      assert.ok(nose.length > 2 && nostrils.length > 0);
      assert.ok(lips.length > 0 && cavity.length > 0);
      assert.ok(chin.length > 0 && tendons.length > 0 && port.length > 0);
      assert.ok(port.every(([, , index]) => scene.buffers.distance[index] <= 0.06));

      for (const field of [scene.buffers.depth, scene.buffers.substrate]) {
        assert.ok(field.every(Number.isFinite));
        assert.ok(field.every((value) => value >= 0 && value <= 1));
        assert.ok(field.some((value) => value > 0.5));
      }
    });
  }
}
