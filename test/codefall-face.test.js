import test from 'node:test';
import assert from 'node:assert/strict';
import { CodefallFace } from '../src/codefall-face.js';
import { FaceModel } from '../src/face/face-model.js';

function createFace(geometry = 'chiseled') {
  const face = Object.create(CodefallFace.prototype);
  const params = { mouthWidth: 0.8 };
  const gaze = { x: 0.2, y: -0.1 };
  const engine = { speaking: true };
  const possession = { active: true, envelope: 0.7 };
  let geometryInvalidations = 0;
  const events = [];
  face.model = new FaceModel(geometry);
  face.geometry = geometry;
  face.params = params;
  face.targetEmotion = 'anger';
  face.state = 'speaking';
  face.coherence = 0.63;
  face._gaze = gaze;
  face.engine = engine;
  face.renderer = {
    possession,
    invalidateGeometry: () => { geometryInvalidations++; },
  };
  face.emit = (type, detail) => events.push({ type, detail });

  return {
    face, params, gaze, engine, possession, events,
    geometryInvalidations: () => geometryInvalidations,
  };
}

function withGeometryDataset(geometry, callback) {
  let writes = 0;
  const dataset = new Proxy({ geometry }, {
    set(target, property, value) {
      writes++;
      target[property] = value;
      return true;
    },
  });

  const previousDocument = globalThis.document;
  globalThis.document = { body: { dataset } };
  try {
    callback({ dataset, writes: () => writes });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test('invalid geometry returns the current style without side effects', () => {
  const { face, events, geometryInvalidations } = createFace('smooth');
  withGeometryDataset('smooth', ({ dataset, writes }) => {
    assert.equal(face.setGeometry('wireframe'), 'smooth');
    assert.equal(dataset.geometry, 'smooth');
    assert.equal(writes(), 0);
    assert.equal(geometryInvalidations(), 0);
    assert.deepEqual(events, []);
  });
});

test('setting the current geometry has no side effects', () => {
  const { face, events, geometryInvalidations } = createFace('chiseled');
  withGeometryDataset('chiseled', ({ dataset, writes }) => {
    assert.equal(face.setGeometry('chiseled'), 'chiseled');
    assert.equal(dataset.geometry, 'chiseled');
    assert.equal(writes(), 0);
    assert.equal(geometryInvalidations(), 0);
    assert.deepEqual(events, []);
  });
});

test('geometry toggle changes only geometry state', () => {
  const {
    face, params, gaze, engine, possession, events, geometryInvalidations,
  } = createFace();
  withGeometryDataset('chiseled', ({ dataset, writes }) => {
    assert.equal(face.toggleGeometry(), 'smooth');
    assert.equal(dataset.geometry, 'smooth');
    assert.equal(writes(), 1);
    assert.deepEqual(events, [{ type: 'geometry', detail: { geometry: 'smooth' } }]);
    assert.equal(face.params, params);
    assert.equal(face.targetEmotion, 'anger');
    assert.equal(face.state, 'speaking');
    assert.equal(face.coherence, 0.63);
    assert.equal(face._gaze, gaze);
    assert.equal(face.engine, engine);
    assert.equal(face.renderer.possession, possession);
    assert.equal(geometryInvalidations(), 1);
  });
});

test('unknown themes normalize controller state to codefall', () => {
  const { face, events } = createFace();
  face.renderer.setTheme = (name) => {
    face.renderer.theme = { name: name === 'wintermute' ? name : 'codefall' };
  };
  withGeometryDataset('chiseled', ({ dataset }) => {
    face.setTheme('unknown');
    assert.equal(face.theme, 'codefall');
    assert.equal(dataset.theme, 'codefall');
    assert.deepEqual(events, [{ type: 'theme', detail: { theme: 'codefall' } }]);
  });
});
