/**
 * Emotion Engine — expression states as parameter fields.
 *
 * An emotion is not a sprite. It is a set of continuous parameters that
 * deform facial topology (brow angle, jaw sharpness, mouth curve),
 * modulate the datastream (rain speed, glyph churn), and drive the
 * failure aesthetics (glitch rate, tear force, luminance).
 *
 * The controller lerps the live parameter set toward the target emotion,
 * so transitions read as the entity *reorganizing itself*, not a swap.
 */

export const NEUTRAL = {
  // Facial topology
  browAngle: 0.0, //  + = inner ends raised (sorrow), − = inner ends lowered (anger)
  browHeight: 0.0, //  vertical brow offset, + = raised
  eyeOpen: 1.0, //  eyelid aperture multiplier
  eyeWidth: 1.0, //  horizontal eye scale
  eyeGlow: 1.0, //  iris/void luminance multiplier
  gazeJitter: 0.0, //  saccadic instability 0..1
  mouthCurve: 0.0, //  + = corners up, − = corners down
  mouthWidth: 1.0,
  mouthTension: 0.5, //  lip-line sharpness/brightness
  jawSharp: 0.6, //  jawline angularity 0..1
  asym: 0.0, //  left/right asymmetry 0..1

  // Datastream behavior
  rainSpeed: 1.0,
  rainDensity: 1.0,
  churn: 0.15, //  baseline glyph turbulence 0..1
  regen: 1.0, //  how fast the face redraws itself

  // Failure aesthetics
  glitchRate: 0.05, //  probability weight of tear events
  tearForce: 0.35, //  displacement magnitude of tears
  flicker: 0.05,

  // Light
  luminance: 1.0,
  hueShift: 0,

  // Idle body language
  swayAmp: 1.0,
  breathAmp: 1.0,
};

export const EMOTIONS = {
  neutral: { ...NEUTRAL },

  confusion: {
    ...NEUTRAL,
    browAngle: 0.18,
    browHeight: 0.25,
    asym: 0.75,
    gazeJitter: 0.7,
    eyeOpen: 0.9,
    mouthWidth: 0.8,
    mouthTension: 0.35,
    churn: 0.4,
    glitchRate: 0.18,
    tearForce: 0.3,
    flicker: 0.18,
    regen: 0.7,
  },

  annoyance: {
    ...NEUTRAL,
    browAngle: -0.22,
    browHeight: -0.2,
    eyeOpen: 0.62,
    eyeGlow: 1.15,
    mouthCurve: -0.25,
    mouthWidth: 0.85,
    mouthTension: 0.85,
    jawSharp: 0.75,
    churn: 0.3,
    glitchRate: 0.22,
    tearForce: 0.45,
    rainSpeed: 1.1,
  },

  anger: {
    ...NEUTRAL,
    browAngle: -0.5,
    browHeight: -0.42,
    eyeOpen: 0.7,
    eyeWidth: 1.05,
    eyeGlow: 1.65,
    mouthCurve: -0.5,
    mouthWidth: 1.1,
    mouthTension: 1.0,
    jawSharp: 1.0,
    churn: 0.45,
    rainSpeed: 1.5,
    glitchRate: 0.5,
    tearForce: 1.0,
    flicker: 0.15,
    luminance: 1.15,
    hueShift: -22, // pull toward acid yellow-green
  },

  frustration: {
    ...NEUTRAL,
    browAngle: -0.32,
    browHeight: -0.15,
    eyeOpen: 0.8,
    eyeGlow: 1.2,
    gazeJitter: 0.45,
    mouthCurve: -0.35,
    mouthTension: 0.9,
    jawSharp: 0.85,
    asym: 0.3,
    churn: 0.65,
    regen: 0.8,
    glitchRate: 0.4,
    tearForce: 0.6,
    flicker: 0.3,
    rainSpeed: 1.25,
  },

  excitement: {
    ...NEUTRAL,
    browHeight: 0.45,
    eyeOpen: 1.25,
    eyeWidth: 1.15,
    eyeGlow: 1.5,
    mouthCurve: 0.45,
    mouthWidth: 1.15,
    mouthTension: 0.7,
    churn: 0.5,
    regen: 1.6,
    rainSpeed: 1.8,
    rainDensity: 1.3,
    glitchRate: 0.15,
    tearForce: 0.3,
    luminance: 1.25,
    swayAmp: 1.4,
    hueShift: 8,
  },

  happiness: {
    ...NEUTRAL,
    browHeight: 0.2,
    eyeOpen: 0.95,
    eyeGlow: 1.25,
    mouthCurve: 0.55,
    mouthWidth: 1.12,
    mouthTension: 0.55,
    churn: 0.25,
    regen: 1.2,
    rainSpeed: 1.2,
    luminance: 1.12,
    swayAmp: 1.1,
  },

  joy: {
    ...NEUTRAL,
    browHeight: 0.5,
    eyeOpen: 1.15,
    eyeWidth: 1.2,
    eyeGlow: 1.6,
    mouthCurve: 0.8,
    mouthWidth: 1.25,
    mouthTension: 0.5,
    churn: 0.55,
    regen: 1.8,
    rainSpeed: 2.0,
    rainDensity: 1.5,
    luminance: 1.3,
    glitchRate: 0.12,
    swayAmp: 1.5,
    breathAmp: 1.3,
    hueShift: 10,
  },

  sadness: {
    ...NEUTRAL,
    browAngle: 0.42,
    browHeight: 0.1,
    eyeOpen: 0.72,
    eyeGlow: 0.6,
    mouthCurve: -0.42,
    mouthWidth: 0.85,
    mouthTension: 0.3,
    jawSharp: 0.35,
    churn: 0.08,
    regen: 0.5,
    rainSpeed: 0.45,
    rainDensity: 0.7,
    glitchRate: 0.04,
    tearForce: 0.2,
    flicker: 0.03,
    luminance: 0.62,
    hueShift: 14, // colder sea-glass green
    swayAmp: 0.5,
    breathAmp: 0.7,
  },
};

export const EMOTION_NAMES = Object.keys(EMOTIONS);

/** Exponential lerp of every parameter toward the target emotion. */
export function blendParams(current, target, dt, rate = 4.5) {
  const k = 1 - Math.exp(-rate * dt);
  for (const key of Object.keys(NEUTRAL)) {
    current[key] += (target[key] - current[key]) * k;
  }
  return current;
}
