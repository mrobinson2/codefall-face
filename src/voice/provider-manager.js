const CAPABILITY_DEFAULTS = Object.freeze({
  tts: false,
  stt: false,
  conversational: false,
  waveform: false,
  retry: false,
});

const AUTO_ORDER = Object.freeze(['azure', 'piper', 'local']);
const ERROR_KINDS = new Set(['unavailable', 'recoverable', 'fatal', 'user-denied']);
const FORWARDED_EVENTS = Object.freeze([
  'ready', 'statechange', 'speechstart', 'speechend', 'pulse', 'audionode',
  'transcript', 'listeningchange', 'error',
]);

function event(type, detail) {
  return new CustomEvent(type, { detail });
}

function capabilities(input = {}) {
  return {
    tts: !!input.tts,
    stt: !!input.stt,
    conversational: !!input.conversational,
    waveform: !!input.waveform,
    retry: input.retry !== false,
  };
}

function normalizeError(error, provider, auto) {
  const cause = error instanceof Error ? error : new Error(String(error));
  let kind = ERROR_KINDS.has(error?.kind) ? error.kind : null;
  if (!kind && ['NotAllowedError', 'SecurityError'].includes(error?.name)) kind = 'user-denied';
  if (!kind && ['AbortError', 'TimeoutError', 'NetworkError'].includes(error?.name)) {
    kind = 'recoverable';
  }
  if (!kind) kind = auto ? 'unavailable' : 'fatal';
  return { kind, provider, message: cause.message || `${provider} failed`, cause };
}

export class ProviderManager extends EventTarget {
  constructor({ config, factories }) {
    super();
    this.config = config;
    this.factories = factories || {};
    this.generation = 0;
    this.status = 'idle';
    this.name = 'silent';
    this.capabilities = { ...CAPABILITY_DEFAULTS };
    this.error = null;
    this.adapter = null;
    this._requestedName = null;
    this._pending = new Set();
    this._disposed = new WeakSet();
    this._forwarded = [];
  }

  start(name = 'auto') {
    if (this.status === 'destroyed') return Promise.resolve(null);
    return this._select(name);
  }

  switchTo(name) {
    return this.start(name);
  }

  retry() {
    if (this.status === 'destroyed' || !this._requestedName ||
        this.error?.kind === 'user-denied' || this.capabilities.retry === false) {
      return Promise.resolve(false);
    }
    return this._select(this._requestedName);
  }

  getSnapshot() {
    return {
      status: this.status,
      name: this.name,
      capabilities: { ...this.capabilities },
      error: this.error,
    };
  }

  destroy() {
    if (this.status === 'destroyed') return false;
    this.generation++;
    this.status = 'destroyed';
    this._clearForwarding();
    for (const adapter of this._pending) this._dispose(adapter);
    this._pending.clear();
    if (this.adapter) this._dispose(this.adapter);
    this.adapter = null;
    this.name = 'silent';
    this.capabilities = { ...CAPABILITY_DEFAULTS };
    this.dispatchEvent(event('change', this.getSnapshot()));
    return true;
  }

  async _select(requested) {
    if (typeof requested !== 'string' ||
        (requested !== 'auto' && !this.factories[requested])) {
      throw new TypeError(`unknown provider: ${requested}`);
    }
    const generation = ++this.generation;
    this._requestedName = requested;
    this.status = 'starting';
    this.error = null;
    this.dispatchEvent(event('change', this.getSnapshot()));

    const auto = requested === 'auto';
    const order = auto ? AUTO_ORDER : [requested];
    let lastError = null;
    for (const name of order) {
      const Factory = this.factories[name];
      if (!Factory) continue;
      const adapter = new Factory(this.config);
      this._pending.add(adapter);
      try {
        await adapter.init();
        this._pending.delete(adapter);
        if (this.status === 'destroyed' || generation !== this.generation) {
          this._dispose(adapter);
          return null;
        }
        this._activate(adapter, name);
        return adapter;
      } catch (error) {
        this._pending.delete(adapter);
        this._dispose(adapter);
        if (this.status === 'destroyed' || generation !== this.generation) return null;
        lastError = normalizeError(error, name, auto);
        if (!auto || lastError.kind === 'user-denied') break;
      }
    }

    if (this.status === 'destroyed' || generation !== this.generation) return null;
    this.error = lastError || normalizeError(new Error('No provider is available'), requested, false);
    this.status = this.error.kind === 'recoverable' ? 'recoverable-error' : 'fatal-error';
    this.name = this.error.provider || requested;
    this.capabilities = { ...CAPABILITY_DEFAULTS, retry: this.error.kind === 'recoverable' };
    this.dispatchEvent(event('error', this.error));
    this.dispatchEvent(event('change', this.getSnapshot()));
    throw this.error.cause;
  }

  _activate(adapter, name) {
    const previous = this.adapter;
    this._clearForwarding();
    this.adapter = adapter;
    this.name = name;
    this.status = 'ready';
    this.error = null;
    this.capabilities = capabilities(adapter.capabilities);
    this._wire(adapter);
    if (previous && previous !== adapter) this._dispose(previous);
    this.dispatchEvent(event('provider', { name, adapter }));
    this.dispatchEvent(event('capabilities', { ...this.capabilities }));
    this.dispatchEvent(event('change', this.getSnapshot()));
  }

  _wire(adapter) {
    for (const type of FORWARDED_EVENTS) {
      const listener = (source) => {
        if (adapter !== this.adapter || this.status === 'destroyed') return;
        this.dispatchEvent(event(type, source.detail || {}));
      };
      adapter.addEventListener(type, listener);
      this._forwarded.push([adapter, type, listener]);
    }
  }

  _clearForwarding() {
    for (const [adapter, type, listener] of this._forwarded) {
      adapter.removeEventListener(type, listener);
    }
    this._forwarded.length = 0;
  }

  _dispose(adapter) {
    if (!adapter || this._disposed.has(adapter)) return;
    this._disposed.add(adapter);
    try { adapter.destroy(); } catch { /* disposal must remain terminal */ }
  }
}

export { normalizeError as normalizeProviderError };
