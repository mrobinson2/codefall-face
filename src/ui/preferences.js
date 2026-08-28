export const PREFERENCE_KEY = 'codefall-face:preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
  version: 1,
  theme: 'wintermute',
  geometry: 'chiseled',
  quality: 'auto',
  motion: 'system',
  visualIntensity: 0.65,
  dock: 'center',
  collapsed: false,
});

const ENUMS = Object.freeze({
  theme: new Set(['wintermute', 'codefall']),
  geometry: new Set(['chiseled', 'smooth']),
  quality: new Set(['auto', 'high', 'medium', 'low']),
  motion: new Set(['system', 'reduce', 'full']),
  dock: new Set(['left', 'center', 'right', 'free']),
});

function normalize(input) {
  const value = { ...DEFAULT_PREFERENCES };
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) {
    return value;
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (allowed.has(input[key])) value[key] = input[key];
  }
  if (Number.isFinite(input.visualIntensity) &&
      input.visualIntensity >= 0 && input.visualIntensity <= 1) {
    value.visualIntensity = input.visualIntensity;
  }
  if (typeof input.collapsed === 'boolean') value.collapsed = input.collapsed;
  return value;
}

export function loadPreferences(storage) {
  try {
    const raw = storage?.getItem(PREFERENCE_KEY);
    if (!raw) return { ok: true, value: { ...DEFAULT_PREFERENCES } };
    return { ok: true, value: normalize(JSON.parse(raw)) };
  } catch (error) {
    return { ok: false, value: { ...DEFAULT_PREFERENCES }, error };
  }
}

export function savePreferences(storage, input) {
  const value = normalize({ ...input, version: 1 });
  try {
    storage?.setItem(PREFERENCE_KEY, JSON.stringify(value));
    return { ok: true, value };
  } catch (error) {
    return { ok: false, value, error };
  }
}

export function clearPreferences(storage) {
  try {
    storage?.removeItem(PREFERENCE_KEY);
    return { ok: true, value: { ...DEFAULT_PREFERENCES } };
  } catch (error) {
    return { ok: false, value: { ...DEFAULT_PREFERENCES }, error };
  }
}

export { normalize as normalizePreferences };
