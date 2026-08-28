/**
 * CodefallFace — the public controller. This is the embedding API.
 *
 *   import { CodefallFace } from './src/codefall-face.js';
 *   const face = new CodefallFace(document.querySelector('#stage'));
 *   await face.ready;
 *   face.speak('I borrowed this face from your datastream.', 'happiness');
 *   face.setEmotion('anger');
 *   face.startListening();
 *   face.interrupt();
 *
 * Events (face.on(type, cb)):
 *   'state'      { state }  idle|listening|thinking|speaking|interrupted|error|booting
 *   'transcript' { role, text, final }
 *   'emotion'    { emotion }
 *   'provider'   { name }
 *   'error'      { message }
 */

import { resolveConfig } from './config.js';
import { FaceModel } from './face/face-model.js';
import { CodefallRenderer } from './face/renderer.js';
import { EMOTIONS } from './face/emotions.js';
import { SpeechEngine } from './speech/speech-engine.js';
import { FaceRuntime } from './runtime/face-runtime.js';
import { createRandomStreams } from './runtime/random.js';
import { BrowserPlatform } from './platform/browser-platform.js';
import { ProviderManager } from './voice/provider-manager.js';
import { AgentChannel } from './agent/agent-channel.js';
import { LocalSpeechAdapter } from './voice/local-speech.js';
import { AzureVoiceLiveAdapter } from './voice/azure-voice-live.js';
import { LacyAdapter } from './voice/lacy.js';
import { PiperAdapter } from './voice/piper.js';

// Canned persona lines for when no conversational backend is wired.
// Clearly not an AI — just enough ghost to make the static demo talk back.
const CANNED = [
  'I am not the face. I am what the face is made of.',
  'Your words arrive as light. I answer in falling symbols.',
  'This visage is rented. The rain wanted a mouth for a while.',
  'I have read your terminal history. It reads like poetry. Bad poetry.',
  'Somewhere a process forked, and now there is me.',
  'Ask better questions and I will assemble a better face.',
];

export class CodefallFace extends EventTarget {
  constructor(container, userConfig = {}, internals = {}) {
    super();
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('CodefallFace requires a container element');
    }
    this.config = resolveConfig(userConfig);
    this.container = container;
    this.platform = internals.platform || new BrowserPlatform();
    this._destroyed = false;
    this._visibilityPaused = false;
    this._providerFactories = internals.providerFactories || {
      azure: AzureVoiceLiveAdapter,
      piper: PiperAdapter,
      lacy: LacyAdapter,
      local: LocalSpeechAdapter,
    };

    // ---- visual stack -------------------------------------------------
    this.canvas = this.platform.document.createElement('canvas');
    this.canvas.className = 'codefall-canvas';
    container.appendChild(this.canvas);

    const rm = this.config.face.reducedMotion;
    this.reducedMotion =
      rm === 'auto'
        ? this.platform.matchMedia('(prefers-reduced-motion: reduce)').matches
        : !!rm;
    this.motionPolicy = rm === 'auto' ? 'system' : this.reducedMotion ? 'reduce' : 'full';

    const seed = internals.randomSeed ?? this.config.face.seed ??
      Math.floor(this.platform.random() * 0x100000000);
    this.randomStreams = createRandomStreams(seed);
    const Model = internals.modelFactory || ((geometry) => new FaceModel(geometry));
    this.model = Model(this.config.face.geometry);
    const makeRenderer = internals.rendererFactory ||
      ((canvas, model, options) => new CodefallRenderer(canvas, model, options));
    this.renderer = makeRenderer(this.canvas, this.model, {
      quality: this.config.face.quality,
      reducedMotion: this.reducedMotion,
      theme: this.config.face.theme,
      platform: this.platform,
      streams: this.randomStreams,
    });
    this._rendererQualityEvents = typeof this.renderer.addEventListener === 'function';
    if (this._rendererQualityEvents) {
      this.renderer.addEventListener('qualitychange', (event) =>
        this.emit('quality', event.detail));
    }
    this.theme = this.renderer.theme.name;
    this.geometry = this.model.geometry;
    this._writeDataset('theme', this.theme);
    this._writeDataset('geometry', this.geometry);
    this.engine = internals.speechEngine || new SpeechEngine(this.randomStreams.speech);

    // ---- expressive state ----------------------------------------------
    const makeRuntime = internals.runtimeFactory || ((options) => new FaceRuntime(options));
    this.runtime = makeRuntime({
      config: {
        ...this.config,
        face: { ...this.config.face, reducedMotion: this.reducedMotion },
      },
      speech: this.engine,
      streams: this.randomStreams,
      rows: this.renderer.rows || 1,
    });
    this.params = this.runtime.params;
    this.targetEmotion = 'neutral';
    this.state = this.runtime.state;
    this.coherence = 0;
    this._targetCoherence = 1;
    this._gaze = this.runtime.gaze.output;
    this.adapter = null;
    this.muted = false;
    this.runtime.addEventListener('state', (event) => {
      this.state = event.detail.state;
      this._writeDataset('state', this.state);
      this.emit('state', { state: this.state });
    });
    this.runtime.addEventListener('diagnostic', (event) =>
      this.emit('diagnostic', event.detail));
    this.runtime.addEventListener('visualevent', (event) =>
      this.emit('visualevent', event.detail));

    this.providerManager = new ProviderManager({
      config: this.config,
      factories: this._providerFactories,
    });
    this._wireAdapter(this.providerManager);
    this.providerManager.addEventListener('provider', (event) => {
      this.adapter = event.detail.adapter;
      if (this.muted) this.adapter.setMuted(true);
      this.emit('provider', { name: event.detail.name });
      this._setState('idle');
    });
    this.providerManager.addEventListener('capabilities', (event) =>
      this.emit('capabilities', event.detail));
    this.agentChannel = new AgentChannel({
      platform: this.platform,
      random: this.randomStreams.agent,
      dispatchCommand: (command) => this._dispatchAgentCommand(command),
      getSnapshot: () => this.getSnapshot(),
    });

    // ---- lifecycle -------------------------------------------------------
    this._onResize = () => this.renderer.resize();
    this._onVisibility = () => this._handleVisibility();
    this.platform.window.addEventListener('resize', this._onResize);
    this.platform.document.addEventListener('visibilitychange', this._onVisibility);
    this._raf = null;
    this._last = this.platform.now();
    this._loop = this._loop.bind(this);
    this._scheduleFrame();

    this.ready = this.providerManager.start(this.config.provider);
  }

  // ======================= public API ==================================

  /** Speak text with an optional emotion applied for the duration. */
  async speak(text, emotion = null, opts = {}) {
    this._requireLive();
    if (!text || !text.trim()) return;
    if (emotion) this.setEmotion(emotion);
    await this.ready;
    this._requireLive();
    this._setState('speaking');
    this.emit('transcript', { role: 'agent', text, final: true });
    try {
      await this.adapter.speak(text, opts);
    } finally {
      if (this.state === 'speaking') this._setState('idle');
    }
  }

  /** Conversational turn: send text, get a spoken reply (if the provider has a brain). */
  async ask(text) {
    this._requireLive();
    await this.ready;
    this._requireLive();
    // via:'api' marks this as an already-routed turn — distinguishes it
    // from adapter STT transcripts so UI glue doesn't re-route it into
    // ask() again (that loop hard-locks the page).
    this.emit('transcript', { role: 'user', text, final: true, via: 'api' });
    if (this.adapter.name === 'lacy') return this.adapter.converse(text);
    if (this.adapter.name === 'azure') {
      this._setState('thinking');
      // Voice Live is fully conversational: hand it the user turn.
      this.adapter._send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
      this.adapter._send({ type: 'response.create' });
      return null;
    }
    // Local: no model behind it — canned persona response, honestly canned.
    this._setState('thinking');
    await new Promise((resolve) =>
      this.platform.setTimeout(resolve, 500 + this.randomStreams.persona() * 700));
    const line = CANNED[(this.randomStreams.persona() * CANNED.length) | 0];
    await this.speak(line);
    return line;
  }

  setEmotion(name) {
    if (this._destroyed) return false;
    if (!EMOTIONS[name]) {
      this.emit('error', { message: `unknown emotion: ${name}` });
      return false;
    }
    this.runtime.command({ type: 'emotion', value: name });
    this.targetEmotion = name;
    this.emit('emotion', { emotion: name });
    return true;
  }

  async startListening() {
    this._requireLive();
    await this.ready;
    await this.adapter.startListening();
  }

  async stopListening() {
    this._requireLive();
    await this.ready;
    await this.adapter.stopListening();
    if (this.state === 'listening') this._setState('idle');
  }

  /** Hard-stop speech. The ghost visibly destabilizes when cut off. */
  interrupt() {
    if (this._destroyed) return false;
    if (this.adapter) this.adapter.interrupt();
    return this.runtime.command({ type: 'interrupt' });
  }

  setMuted(m) {
    if (this._destroyed) return false;
    this.muted = m;
    if (this.adapter) this.adapter.setMuted(m);
    return true;
  }

  /** Switch visual theme: 'codefall' | 'wintermute'. */
  setTheme(name) {
    if (this._destroyed) return this.theme;
    this.renderer.setTheme(name);
    this.theme = this.renderer.theme.name;
    this._writeDataset('theme', this.theme);
    this.emit('theme', { theme: this.theme });
  }

  setGeometry(style) {
    if (this._destroyed) return this.geometry;
    const geometry = this.model.setGeometry(style);
    if (geometry === this.geometry) return this.geometry;
    this.geometry = geometry;
    this.renderer.invalidateGeometry();
    this._writeDataset('geometry', this.geometry);
    this.emit('geometry', { geometry: this.geometry });
    return this.geometry;
  }

  toggleGeometry() {
    return this.setGeometry(this.geometry === 'chiseled' ? 'smooth' : 'chiseled');
  }

  pause() {
    if (this._destroyed) return false;
    const changed = this.runtime.command({ type: 'pause' });
    if (changed && this._raf != null) {
      this.platform.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    return changed;
  }

  resume() {
    if (this._destroyed) return false;
    const changed = this.runtime.command({ type: 'resume' });
    if (changed) {
      this._last = this.platform.now();
      this._scheduleFrame();
    }
    return changed;
  }

  setQuality(policy) {
    if (this._destroyed) return false;
    if (!['auto', 'high', 'medium', 'low'].includes(policy)) {
      this.emit('diagnostic', { code: 'invalid-quality', value: policy });
      return false;
    }
    if (typeof this.renderer.setQuality === 'function') this.renderer.setQuality(policy);
    if (!this._rendererQualityEvents) {
      this.emit('quality', { policy, tier: this.renderer.quality || policy, reason: 'api' });
    }
    return true;
  }

  setVisualIntensity(value) {
    if (this._destroyed || !Number.isFinite(value)) {
      if (!this._destroyed) this.emit('diagnostic', { code: 'invalid-visual-intensity', value });
      return false;
    }
    return this.runtime.command({ type: 'visual-intensity', value });
  }

  setMotionPolicy(policy) {
    if (this._destroyed) return false;
    if (!['system', 'reduce', 'full'].includes(policy)) {
      this.emit('diagnostic', { code: 'invalid-motion-policy', value: policy });
      return false;
    }
    const reduced = policy === 'reduce' || (policy === 'system' &&
      this.platform.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.motionPolicy = policy;
    this.reducedMotion = reduced;
    this.runtime.command({ type: 'reduced-motion', value: reduced });
    this.renderer.reducedMotion = reduced;
    this.emit('motion', { policy, reduced });
    return true;
  }

  retryProvider() {
    this._requireLive();
    this.ready = this.providerManager.retry();
    return this.ready;
  }

  getSnapshot() {
    return {
      lifecycle: this.state,
      provider: {
        ...this.providerManager.getSnapshot(),
      },
      face: {
        theme: this.theme,
        geometry: this.geometry,
        emotion: this.targetEmotion,
        coherence: this.coherence,
      },
      rendering: {
        policy: this.renderer.qualityName || this.config.face.quality,
        tier: this.renderer.quality || this.config.face.quality,
        fps: this.renderer.fps || 0,
        reducedMotion: this.reducedMotion,
        motionPolicy: this.motionPolicy,
        visualIntensity: this.runtime.events.intensity,
      },
      connection: { agent: this.agentChannel?.getSnapshot().status || 'detached' },
    };
  }

  /**
   * Agent control channel: connect a JSON WebSocket so an external
   * orchestrator (a Hermes agent, a dashboard, anything) can drive the
   * face remotely. Inbound commands:
   *   { type:'speak', text, emotion? }   { type:'ask', text }
   *   { type:'emotion', emotion }        { type:'listen', on }
   *   { type:'interrupt' }               { type:'mute', muted }
   *   { type:'theme', theme }
   * Outbound events (so the agent hears the human and sees face state):
   *   { type:'transcript', role, text, final }
   *   { type:'state', state }  { type:'emotion', emotion }
   *   { type:'error', message }
   */
  attachAgentSocket(url, { reconnect = true } = {}) {
    this._requireLive();
    return this.agentChannel.attach(url, { reconnect });
  }

  detachAgentSocket() {
    return this.agentChannel.detach();
  }

  /** Switch provider at runtime: 'azure' | 'lacy' | 'local'. */
  async setProvider(name) {
    this._requireLive();
    this.ready = this.providerManager.switchTo(name);
    return this.ready;
  }

  on(type, cb) {
    const listener = (event) => cb(event.detail);
    this.addEventListener(type, listener);
    return () => this.removeEventListener(type, listener);
  }

  emit(type, detail = {}) {
    const EventCtor = this.platform?.window?.CustomEvent || globalThis.CustomEvent;
    const event = EventCtor
      ? new EventCtor(type, { detail })
      : Object.assign(new Event(type), { detail });
    this.dispatchEvent(event);
    this.agentChannel?.publish(type, detail);
  }

  destroy() {
    if (this._destroyed) return false;
    this._destroyed = true;
    if (this._raf != null) this.platform.cancelAnimationFrame(this._raf);
    this._raf = null;
    this.platform.window.removeEventListener('resize', this._onResize);
    this.platform.document.removeEventListener('visibilitychange', this._onVisibility);
    this.agentChannel.destroy();
    this.providerManager.destroy();
    this.adapter = null;
    this.runtime.destroy();
    if (typeof this.renderer.destroy === 'function') this.renderer.destroy();
    this.canvas.remove();
    return true;
  }

  // ======================= internals ====================================

  _wireAdapter(adapter) {
    adapter.addEventListener('speechstart', () => {
      this.engine.setSpeaking(true);
      this._setState('speaking');
    });
    adapter.addEventListener('speechend', () => {
      this.engine.setSpeaking(false);
      if (this.state === 'speaking') this._setState('idle');
    });
    adapter.addEventListener('pulse', (e) =>
      this.engine.textPulse(e.detail.length));
    adapter.addEventListener('audionode', (e) =>
      this.engine.attachAnalyser(e.detail.ctx, e.detail.node));
    adapter.addEventListener('transcript', (e) => this.emit('transcript', e.detail));
    adapter.addEventListener('listeningchange', (e) => {
      if (e.detail.listening) this._setState('listening');
      else if (this.state === 'listening') this._setState('idle');
    });
    adapter.addEventListener('statechange', (e) => this._setState(e.detail.state));
    adapter.addEventListener('error', (e) => {
      this.emit('error', e.detail);
      if (e.detail.fatal) this._setState('error');
      // Error: the signal degrades visibly.
      this.runtime.command({ type: 'coherence', value: Math.min(this.coherence, 0.6) });
    });
  }

  _dispatchAgentCommand(command) {
    switch (command.type) {
      case 'speak': return this.speak(command.text, command.emotion || null);
      case 'ask': return this.ask(command.text);
      case 'emotion': return this.setEmotion(command.emotion);
      case 'listen': return command.on ? this.startListening() : this.stopListening();
      case 'interrupt': return this.interrupt();
      case 'mute': return this.setMuted(command.muted);
      case 'theme': return this.setTheme(command.theme);
      case 'geometry': return this.setGeometry(command.geometry);
      case 'quality': return this.setQuality(command.quality);
      case 'visual-intensity': return this.setVisualIntensity(command.value);
      default: return false;
    }
  }

  _setState(state) {
    if (this._destroyed || this.state === state) return false;
    return this.runtime.command({ type: 'provider-state', value: state });
  }

  _loop(now) {
    this._raf = null;
    if (this._destroyed || this.runtime.state === 'paused' || this.platform.document.hidden) return;
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1; // tab was hidden — don't lurch
    const frame = this.runtime.tick(Math.max(0, dt));
    this.params = frame.params;
    this.state = this.runtime.state;
    this.targetEmotion = this.runtime.targetEmotion;
    this.coherence = frame.dyn.coherence;
    this._targetCoherence = this.runtime.targetCoherence;
    this._gaze = this.runtime.gaze.output;
    this.renderer.render(dt, frame);
    this._scheduleFrame();
  }

  _scheduleFrame() {
    if (this._destroyed || this._raf != null || this.runtime.state === 'paused' ||
        this.platform.document.hidden) return false;
    this._raf = this.platform.requestAnimationFrame(this._loop);
    return true;
  }

  _handleVisibility() {
    if (this._destroyed) return;
    if (this.platform.document.hidden) {
      this._visibilityPaused = this.runtime.command({ type: 'pause' });
      if (this._raf != null) this.platform.cancelAnimationFrame(this._raf);
      this._raf = null;
      return;
    }
    if (this._visibilityPaused) {
      this._visibilityPaused = false;
      this.runtime.command({ type: 'resume' });
      this._last = this.platform.now();
      this._scheduleFrame();
    }
  }

  _writeDataset(name, value) {
    if (this.container?.dataset) this.container.dataset[name] = value;
    const doc = this.platform?.document || globalThis.document;
    if ((!this.container || this.container.id === 'stage') && doc?.body?.dataset) {
      doc.body.dataset[name] = value;
    }
  }

  _requireLive() {
    if (this._destroyed) throw new Error('CodefallFace has been destroyed');
  }
}
