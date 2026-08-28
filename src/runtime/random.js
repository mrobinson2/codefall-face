const DEFAULT_STREAMS = Object.freeze([
  'gaze', 'blink', 'rain', 'debris', 'events', 'speech', 'persona', 'agent',
]);

function hashName(seed, name) {
  let hash = (Number(seed) >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

function generator(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function createRandomStreams(seed, names = DEFAULT_STREAMS) {
  const streams = {};
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('random stream name must be non-empty');
    if (seen.has(name)) throw new TypeError(`duplicate random stream name: ${name}`);
    seen.add(name);
    streams[name] = generator(hashName(seed, name));
  }
  return Object.freeze(streams);
}
