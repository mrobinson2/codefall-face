/**
 * Codefall Face — configuration.
 *
 * Everything here can be overridden before the app boots by defining
 * `window.CODEFALL_CONFIG = { ... }` in a script tag ahead of main.js,
 * or by passing a config object to `new CodefallFace(container, config)`.
 *
 * No secrets belong in this file. Azure Voice Live is reached through a
 * relay backend (see server/server.mjs) precisely so that keys never
 * ship to the browser.
 */

const defaults = {
  // 'auto' | 'azure' | 'lacy' | 'local'
  // auto: use azure if a relay is reachable, otherwise local Web Speech.
  provider: 'auto',

  azure: {
    // WebSocket relay endpoint (server/server.mjs). Same-origin by default.
    relayUrl: null, // null → derive ws(s)://<host>/relay
    // Voice Live voice to request. Any Azure neural voice name works.
    voice: 'en-US-AndrewMultilingualNeural',
    // Instructions given to the Voice Live model for conversational mode.
    instructions:
      'You are Codefall Face, an emergent digital intelligence speaking ' +
      'through a face assembled from falling code. Be concise, calculating, ' +
      'quietly eerie, and helpful. Never break character.',
  },

  lacy: {
    // Backend proxy base for Lacy.ai REST calls (see server/server.mjs).
    proxyBase: '/api/lacy',
  },

  local: {
    // Preferred Web Speech voices, first match wins. These are system
    // voices — list yours with speechSynthesis.getVoices() in the
    // console, or try one instantly via the ?voice= URL param
    // (?voice=Ralph for depth, ?voice=Trinoids for full retro-robot on
    // macOS). Deeper voices + low pitch = more ghost.
    preferredVoices: ['Daniel', 'Alex', 'Google UK English Male', 'Microsoft David'],
    rate: 0.9,
    pitch: 0.55, // 0..2 — low pitch does most of the "entity" work
  },

  // Post-processing for provider audio that plays through Web Audio
  // (the Azure Voice Live path): a ring-modulator + band-shaping chain
  // that makes any neural voice sound like a transmission from inside
  // the machine. No effect on Web Speech voices (the browser gives us
  // no audio node for those).
  voiceFx: {
    enabled: true,
    ringHz: 30, // classic robot flutter (Daleks used ~30 Hz)
    ringDepth: 0.35, // 0 = clean voice, 1 = full metallic
    lowpassHz: 3400, // telephone-band ceiling
    highpassHz: 220, // cut the warm lows — ghosts have no chest
  },

  face: {
    // 'codefall' (neon green matrix) | 'wintermute' (ice-white voxel ghost)
    theme: 'wintermute',
    // 'chiseled' | 'smooth'
    geometry: 'chiseled',
    // 'auto' | 'high' | 'medium' | 'low'
    quality: 'auto',
    // Respect prefers-reduced-motion unless explicitly set false.
    reducedMotion: 'auto',
    // Seconds for the boot "assembly from the datastream" sequence.
    bootDuration: 4.0,
  },

  debug: false,
};

function deepMerge(base, over) {
  if (!over) return base;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] =
      over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])
        ? deepMerge(base[k] ?? {}, over[k])
        : over[k];
  }
  return out;
}

export function resolveConfig(userConfig) {
  const winConfig = typeof window !== 'undefined' ? window.CODEFALL_CONFIG : null;
  return deepMerge(deepMerge(defaults, winConfig), userConfig);
}
