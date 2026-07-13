import test from 'node:test';
import assert from 'node:assert/strict';
import { CodefallFace } from '../src/codefall-face.js';
import { FaceModel } from '../src/face/face-model.js';

test('geometry toggle changes only geometry state', () => {
  const face = Object.create(CodefallFace.prototype);
  const params = { mouthWidth: 0.8 };
  const gaze = { x: 0.2, y: -0.1 };
  const engine = { speaking: true };
  const possession = { active: true, envelope: 0.7 };
  const events = [];
  face.model = new FaceModel('chiseled');
  face.geometry = 'chiseled';
  face.params = params;
  face.targetEmotion = 'anger';
  face.state = 'speaking';
  face.coherence = 0.63;
  face._gaze = gaze;
  face.engine = engine;
  face.renderer = { possession };
  face.emit = (type, detail) => events.push({ type, detail });

  const previousDocument = globalThis.document;
  globalThis.document = { body: { dataset: {} } };
  try {
    assert.equal(face.toggleGeometry(), 'smooth');
    assert.equal(document.body.dataset.geometry, 'smooth');
    assert.deepEqual(events, [{ type: 'geometry', detail: { geometry: 'smooth' } }]);
    assert.equal(face.params, params);
    assert.equal(face.targetEmotion, 'anger');
    assert.equal(face.state, 'speaking');
    assert.equal(face.coherence, 0.63);
    assert.equal(face._gaze, gaze);
    assert.equal(face.engine, engine);
    assert.equal(face.renderer.possession, possession);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
