/**
 * Glyph vocabulary and phosphor palette for Codefall Face.
 *
 * The face is drawn from a fixed atlas of characters pre-rendered at
 * several brightness tiers. Region charsets give different anatomy a
 * different symbolic texture: rain is katakana/digits, contours are
 * directional strokes, eyes are dense ring glyphs, the mouth is
 * horizontal tension marks.
 */

// Brightness ramp, dim → bright. Used for generic face "flesh".
export const RAMP = '·:;+=oxa*#%@';

// Classic codefall set: half-width katakana, digits, terminal debris.
export const RAIN =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z<>*+=-¦:・.';

// Directional contour strokes, indexed by contour angle bucket:
// 0: horizontal, 1: rising diagonal, 2: vertical, 3: falling diagonal.
export const EDGE = ['—', '/', '|', '\\'];

// Eyes: dense circular glyphs that read as lenses/voids.
export const EYE = '◉@0OØ0';

// Mouth: horizontal tension marks and static.
export const MOUTH = '-=~≈#=';

// Voxel blocks (wintermute theme flesh + disintegration debris),
// ordered dim → bright so intensity can index them.
export const BLOCKS = '·▫▪□■';
export const DEBRIS = '▪▫□·';

export const TILES_WIDE = '▪■□';
export const TILES_FINE = '·▫▪';
export const SEAMS = '¦—/\\';
export const MACHINE = '0OØ◉#';

export const MATERIAL = {
  NONE: 0,
  TILE: 1,
  FINE: 2,
  SEAM: 3,
  APERTURE: 4,
  MACHINE: 5,
  LOOSE: 6,
};

export function wintermuteGlyphFor(material, intensity, seed) {
  const vocab = material === MATERIAL.FINE ? TILES_FINE
    : material === MATERIAL.SEAM ? SEAMS
      : material === MATERIAL.APERTURE || material === MATERIAL.MACHINE ? MACHINE
        : TILES_WIDE;
  const lightBias = Math.min(vocab.length - 1, Math.floor(intensity * vocab.length));
  const jitter = Math.floor(seed * vocab.length) % vocab.length;
  return vocab[(lightBias + jitter) % vocab.length];
}

// Region ids written into the region buffer by the face model.
export const REGION = {
  VOID: 0, // outside the head — background rain only
  FACE: 1, // generic interior
  EDGE: 2, // head/jaw contour band
  EYE: 3,
  BROW: 4,
  NOSE: 5,
  MOUTH: 6,
  MOUTH_INNER: 7,
  SHARD: 8, // fragmentation aura — pixel blocks scattered off the silhouette
};

// Full atlas charset: union of everything above, deduplicated.
export const ATLAS_CHARS = [
  ...new Set((RAMP + RAIN + EDGE.join('') + EYE + MOUTH + BLOCKS + DEBRIS
    + TILES_WIDE + TILES_FINE + SEAMS + MACHINE).split('')),
];

export const CHAR_INDEX = new Map(ATLAS_CHARS.map((c, i) => [c, i]));

export const TIERS = 6;

/**
 * Visual themes.
 *   codefall   — the classic neon-green matrix phosphor.
 *   wintermute — monochrome ice-white voxel ghost (halo ring, block
 *                flesh, faint cold cyan), after the Neuromancer AI.
 */
export const THEMES = {
  codefall: {
    name: 'codefall', hue: 140, sat: 1.0, blocky: false,
    rainDim: 1.0, ring: 0.22, detail: 0.45,
  },
  wintermute: {
    name: 'wintermute', hue: 204, sat: 0.13, blocky: true,
    rainDim: 0.42, ring: 1.0, detail: 1.0,
  },
};

/**
 * Phosphor palette for a base hue. Emotion hueShift nudges it (acid for
 * anger, cold for sadness) without abandoning the theme's identity.
 * Returns TIERS css colors, dim → near-white bloom.
 */
export function makeTiers(hue = 140, satScale = 1) {
  const stops = [
    [70, 14],
    [85, 24],
    [95, 36],
    [100, 50],
    [90, 66],
    [55, 88],
  ];
  return stops.map(([s, l]) => `hsl(${hue}, ${Math.min(100, s * satScale)}%, ${l}%)`);
}

/** Map a 0..1 intensity to an atlas tier index. */
export function tierFor(intensity) {
  const t = Math.floor(intensity * TIERS);
  return t < 0 ? 0 : t >= TIERS ? TIERS - 1 : t;
}

/** Map a 0..1 intensity to a RAMP character index. */
export function rampChar(intensity) {
  const i = Math.floor(intensity * RAMP.length);
  return RAMP[i < 0 ? 0 : i >= RAMP.length ? RAMP.length - 1 : i];
}
