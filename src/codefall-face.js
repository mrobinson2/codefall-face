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
import { EMOTIONS, NEUTRAL, blendParams } from './face/emotions.js';
import { SpeechEngine } from './speech/speech-engine.js';
import { LocalSpeechAdapter } from './voice/local-speech.js';
import { AzureVoiceLiveAdapter } from './voice/azure-voice-live.js';
import { LacyAdapter } from './voice/lacy.js';

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
  constructor(container, userConfig = {}) {
    super();
    this.config = resolveConfig(userConfig);
    this.container = container;

    // ---- visual stack -------------------------------------------------
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'codefall-canvas';
    container.appendChild(this.canvas);

    const rm = this.config.face.reducedMotion;
    this.reducedMotion =
      rm === 'auto'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : !!rm;

    this.model = new FaceModel();
    this.renderer = new CodefallRenderer(this.canvas, this.model, {
      quality: this.config.face.quality,
      reducedMotion: this.reducedMotion,
      theme: this.config.face.theme,
    });
    this.theme = this.config.face.theme;
    document.body.dataset.theme = this.theme;
    this.engine = new SpeechEngine();

    // ---- expressive state ----------------------------------------------
    this.params = { ...NEUTRAL };
    this.targetEmotion = 'neutral';
    this.state = 'booting';
    this.coherence = 0;
    this._targetCoherence = 1;
    this._gaze = { x: 0, y: 0, tx: 0, ty: 0, timer: 0 };
    this.adapter = null;
    this.muted = false;

    // ---- lifecycle -------------------------------------------------------
    this._onResize = () => this.renderer.resize();
    window.addEventListener('resize', this._onResize);
    this._raf = null;
    this._last = performance.now();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);

    this.ready = this._initProvider();
  }

  // ======================= public API ==================================

  /** Speak text with an optional emotion applied for the duration. */
  async speak(text, emotion = null, opts = {}) {
    if (!text || !text.trim()) return;
    if (emotion) this.setEmotion(emotion);
    await this.ready;
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
    await this.ready;
    this.emit('transcript', { role: 'user', text, final: true });
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
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 700));
    const line = CANNED[(Math.random() * CANNED.length) | 0];
    await this.speak(line);
    return line;
  }

  setEmotion(name) {
    if (!EMOTIONS[name]) {
      this.emit('error', { message: `unknown emotion: ${name}` });
      return;
    }
    this.targetEmotion = name;
    this.emit('emotion', { emotion: name });
  }

  async startListening() {
    await this.ready;
    await this.adapter.startListening();
  }

  async stopListening() {
    await this.ready;
    await this.adapter.stopListening();
    if (this.state === 'listening') this._setState('idle');
  }

  /** Hard-stop speech. The ghost visibly destabilizes when cut off. */
  interrupt() {
    if (this.adapter) this.adapter.interrupt();
    this.engine.setSpeaking(false);
    this.coherence = Math.min(this.coherence, 0.45);
    this._setState('interrupted');
    setTimeout(() => {
      if (this.state === 'interrupted') this._setState('idle');
    }, 700);
  }

  setMuted(m) {
    this.muted = m;
    if (this.adapter) this.adapter.setMuted(m);
  }

  /** Switch visual theme: 'codefall' | 'wintermute'. */
  setTheme(name) {
    this.theme = name;
    this.renderer.setTheme(name);
    document.body.dataset.theme = name;
    this.emit('theme', { theme: name });
  }

  /** Switch provider at runtime: 'azure' | 'lacy' | 'local'. */
  async setProvider(name) {
    if (this.adapter) this.adapter.destroy();
    this.adapter = null;
    this.ready = this._initProvider(name);
    return this.ready;
  }

  on(type, cb) { this.addEventListener(type, (e) => cb(e.detail)); }
  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    if (this.adapter) this.adapter.destroy();
    this.canvas.remove();
  }

  // ======================= internals ====================================

  async _initProvider(forced = null) {
    const want = forced || this.config.provider;
    const attempts = [];
    if (want === 'auto') attempts.push('azure', 'local');
    else attempts.push(want);

    for (const name of attempts) {
      const Adapter = { azure: AzureVoiceLiveAdapter, lacy: LacyAdapter, local: LocalSpeechAdapter }[name];
      if (!Adapter) continue;
      const adapter = new Adapter(this.config);
      try {
        this._wireAdapter(adapter);
        await adapter.init();
        this.adapter = adapter;
        this.emit('provider', { name });
        this._setState('idle');
        return adapter;
      } catch (err) {
        adapter.destroy();
        if (attempts.length === 1) {
          this._setState('error');
          this.emit('error', { message: `${name}: ${err.message}` });
          throw err;
        }
      }
    }
    // Nothing viable — face still renders; voice is silent-animate only.
    this.adapter = new LocalSpeechAdapter(this.config);
    this._wireAdapter(this.adapter);
    this.adapter.setMuted(true);
    this.emit('provider', { name: 'silent' });
    this._setState('idle');
    return this.adapter;
  }

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
      this.coherence = Math.min(this.coherence, 0.6);
    });
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', { state });
  }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1; // tab was hidden — don't lurch
    if (document.hidden) return;

    // Boot assembly: the face condenses out of the rain.
    const bootRate = 1 / Math.max(0.5, this.config.face.bootDuration);
    this.coherence += (this._targetCoherence - this.coherence) *
      Math.min(1, (this.state === 'booting' ? bootRate * 1.6 : 2.2) * dt);
    if (this.state === 'booting' && this.coherence > 0.92) this._setState('idle');

    // Gaze: idle wander / thinking saccades / listening focus.
    const g = this._gaze;
    g.timer -= dt;
    if (g.timer <= 0) {
      if (this.state === 'thinking') {
        g.tx = (Math.random() - 0.5) * 2.4; g.ty = (Math.random() - 0.5) * 1.6;
        g.timer = 0.12 + Math.random() * 0.2;
      } else if (this.state === 'listening') {
        g.tx = 0; g.ty = -0.3; g.timer = 0.5;
      } else {
        g.tx = (Math.random() - 0.5) * 1.2; g.ty = (Math.random() - 0.5) * 0.8;
        g.timer = 0.8 + Math.random() * 2.5;
      }
    }
    const gk = Math.min(1, 14 * dt);
    g.x += (g.tx - g.x) * gk;
    g.y += (g.ty - g.y) * gk;

    // Emotion parameter blending + jitter from gazeJitter.
    blendParams(this.params, EMOTIONS[this.targetEmotion], dt);
    const jit = this.params.gazeJitter;
    const jx = jit ? (Math.random() - 0.5) * jit * 1.4 : 0;
    const jy = jit ? (Math.random() - 0.5) * jit * 0.8 : 0;

    this.engine.tick(dt);
    const s = this.engine.out;

    this.renderer.render(dt, {
      params: this.params,
      mode: this.state,
      dyn: {
        mouthOpen: s.open,
        mouthWide: s.wide,
        tension: s.tension,
        energy: s.energy,
        gazeX: g.x + jx,
        gazeY: g.y + jy,
        coherence: this.coherence,
        blink: 1, swayX: 0, swayY: 0, t: 0, // renderer fills these
      },
    });
  }
}
