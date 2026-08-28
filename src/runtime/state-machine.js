export const FACE_STATES = Object.freeze([
  'booting', 'idle', 'listening', 'thinking', 'speaking',
  'interrupted', 'error', 'paused', 'destroyed',
]);

const ALLOWED = Object.freeze({
  booting: new Set(['idle', 'error']),
  idle: new Set(['listening', 'thinking', 'speaking', 'interrupted', 'error']),
  listening: new Set(['idle', 'thinking', 'speaking', 'interrupted', 'error']),
  thinking: new Set(['idle', 'listening', 'speaking', 'interrupted', 'error']),
  speaking: new Set(['idle', 'listening', 'interrupted', 'error']),
  interrupted: new Set(['idle', 'error']),
  error: new Set(['idle']),
  paused: new Set(),
  destroyed: new Set(),
});

function event(type, detail) {
  return new CustomEvent(type, { detail });
}

export class FaceStateMachine extends EventTarget {
  constructor(initial = 'booting') {
    super();
    if (!FACE_STATES.includes(initial)) throw new TypeError(`unknown face state: ${initial}`);
    this.state = initial;
    this.previous = null;
    this._pausedState = null;
  }

  transition(next, detail = {}) {
    if (next === this.state) return false;
    if (!FACE_STATES.includes(next) || this.state === 'destroyed' ||
        next === 'paused' || next === 'destroyed' || !ALLOWED[this.state].has(next)) {
      this.dispatchEvent(event('diagnostic', {
        code: 'invalid-transition',
        previous: this.state,
        requested: next,
      }));
      return false;
    }
    return this._apply(next, detail);
  }

  pause() {
    if (this.state === 'paused' || this.state === 'destroyed') return false;
    this._pausedState = this.state;
    return this._apply('paused', { reason: 'pause' });
  }

  resume() {
    if (this.state !== 'paused') return false;
    const next = this._pausedState || 'idle';
    this._pausedState = null;
    return this._apply(next, { reason: 'resume' });
  }

  destroy() {
    if (this.state === 'destroyed') return false;
    this._pausedState = null;
    return this._apply('destroyed', { reason: 'destroy' });
  }

  _apply(next, detail) {
    const previous = this.state;
    this.previous = previous;
    this.state = next;
    this.dispatchEvent(event('change', { previous, state: next, detail }));
    return true;
  }

  get snapshot() {
    return Object.freeze({ state: this.state, previous: this.previous });
  }
}
