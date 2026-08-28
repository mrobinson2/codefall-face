const MAX_STRING = 16 * 1024;

const SCHEMAS = Object.freeze({
  speak: { required: { text: 'string' }, optional: { emotion: 'string' } },
  ask: { required: { text: 'string' } },
  emotion: { required: { emotion: 'string' } },
  listen: { required: { on: 'boolean' } },
  interrupt: { required: {} },
  mute: { required: { muted: 'boolean' } },
  theme: { required: { theme: ['wintermute', 'codefall'] } },
  geometry: { required: { geometry: ['chiseled', 'smooth'] } },
  quality: { required: { quality: ['auto', 'high', 'medium', 'low'] } },
  'visual-intensity': { required: { value: 'finite-number' } },
});

function failure(code, message) {
  return { ok: false, code, message };
}

function byteLength(value) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength;
  return value.length;
}

function valid(value, rule) {
  if (Array.isArray(rule)) return rule.includes(value);
  if (rule === 'finite-number') return typeof value === 'number' && Number.isFinite(value);
  if (typeof value !== rule) return false;
  return rule !== 'string' || (value.length > 0 && value.length <= MAX_STRING);
}

export function parseAgentCommand(raw, maxBytes = 65536) {
  if (typeof raw !== 'string') return failure('bad-shape', 'Agent messages must be JSON text');
  if (byteLength(raw) > maxBytes) {
    return failure('message-too-large', 'Agent message exceeds the configured size limit');
  }
  let command;
  try { command = JSON.parse(raw); } catch {
    return failure('bad-json', 'Agent message is not valid JSON');
  }
  if (!command || Array.isArray(command) || typeof command !== 'object') {
    return failure('bad-shape', 'Agent command must be a JSON object');
  }
  if (typeof command.type !== 'string' || !SCHEMAS[command.type]) {
    return failure('unknown-command', 'Agent command type is not supported');
  }
  const schema = SCHEMAS[command.type];
  const allowed = new Set(['type', ...Object.keys(schema.required), ...Object.keys(schema.optional || {})]);
  if (Object.keys(command).some((key) => !allowed.has(key))) {
    return failure('invalid-field', 'Agent command includes an unsupported field');
  }
  for (const [key, rule] of Object.entries(schema.required)) {
    if (!Object.hasOwn(command, key) || !valid(command[key], rule)) {
      return failure('invalid-field', 'Agent command has a missing or invalid required field');
    }
  }
  for (const [key, rule] of Object.entries(schema.optional || {})) {
    if (Object.hasOwn(command, key) && !valid(command[key], rule)) {
      return failure('invalid-field', 'Agent command has an invalid optional field');
    }
  }
  return { ok: true, command };
}
