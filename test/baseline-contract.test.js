import test from 'node:test';
import assert from 'node:assert/strict';
import { CodefallFace } from '../src/codefall-face.js';

test('CodefallFace keeps the v2 compatibility surface', () => {
  for (const name of [
    'speak', 'ask', 'setEmotion', 'startListening', 'stopListening',
    'interrupt', 'setMuted', 'setTheme', 'setGeometry', 'toggleGeometry',
    'setProvider', 'attachAgentSocket', 'detachAgentSocket', 'on', 'destroy',
  ]) assert.equal(typeof CodefallFace.prototype[name], 'function', name);
});
