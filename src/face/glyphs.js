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
};

// Full atlas charset: union of everything above, deduplicated.
export const ATLAS_CHARS = [
  ...new Set((RAMP + RAIN + EDGE.join('') + EYE + MOUTH).split('')),
];

export const CHAR_INDEX = new Map(ATLAS_CHARS.map((c, i) => [c, i]));

export const TIERS = 6;

/**
 * Phosphor palette. hueShift lets emotions pull the green toward acid
 * (anger) or cold sea-glass (sadness) without abandoning the identity.
 * Returns TIERS css colors, dim → near-white bloom.
 */
export function makeTiers(hueShift = 0, satScale = 1) {
  const h = 140 + hueShift;
  const stops = [
    [70, 14],
    [85, 24],
    [95, 36],
    [100, 50],
    [90, 66],
    [55, 88],
  ];
  return stops.map(([s, l]) => `hsl(${h}, ${Math.min(100, s * satScale)}%, ${l}%)`);
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
