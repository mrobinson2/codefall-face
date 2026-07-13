import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATLAS_CHARS, MATERIAL, MACHINE, SEAMS, TILES_FINE, TILES_WIDE,
  wintermuteGlyphFor,
} from '../src/face/glyphs.js';

test('every wintermute material glyph exists in the atlas', () => {
  for (const chars of [TILES_WIDE, TILES_FINE, SEAMS, MACHINE]) {
    for (const char of chars) assert.ok(ATLAS_CHARS.includes(char), char);
  }
});

test('seams contains exactly four distinct directional glyphs', () => {
  assert.equal(SEAMS, '¦—/\\');
  assert.equal(SEAMS.length, 4);
});

test('material selection is deterministic for a fixed seed', () => {
  assert.equal(
    wintermuteGlyphFor(MATERIAL.FINE, 0.7, 0.42),
    wintermuteGlyphFor(MATERIAL.FINE, 0.7, 0.42),
  );
});

test('aperture material selects a dark machine glyph', () => {
  assert.ok(MACHINE.includes(wintermuteGlyphFor(MATERIAL.APERTURE, 0.8, 0.5)));
});

test('negative intensity selects a defined glyph for every wintermute material', () => {
  const vocabularies = [
    [MATERIAL.TILE, TILES_WIDE],
    [MATERIAL.FINE, TILES_FINE],
    [MATERIAL.SEAM, SEAMS],
    [MATERIAL.APERTURE, MACHINE],
    [MATERIAL.MACHINE, MACHINE],
    [MATERIAL.LOOSE, TILES_WIDE],
  ];
  for (const [material, vocabulary] of vocabularies) {
    const glyph = wintermuteGlyphFor(material, -0.5, 0);
    assert.ok(vocabulary.includes(glyph), `material ${material}: ${glyph}`);
  }
});
