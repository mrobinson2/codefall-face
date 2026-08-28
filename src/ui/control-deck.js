import { EMOTION_NAMES } from '../face/emotions.js';
import { loadPreferences, savePreferences } from './preferences.js';

const STATUS_LABEL = Object.freeze({
  booting: 'MATERIALIZING',
  idle: 'IDLE',
  listening: 'LISTENING',
  thinking: 'THINKING',
  speaking: 'SPEAKING',
  interrupted: 'INTERRUPTED',
  error: 'SIGNAL LOST',
  paused: 'PAUSED',
});

export class ControlDeck {
  constructor({ root, face, storage, onDemo = null, onInterrupt = null }) {
    this.root = root;
    this.face = face;
    this.storage = storage;
    this.onDemo = onDemo;
    this.onInterrupt = onInterrupt;
    this.preferences = loadPreferences(storage).value;
    this._mounted = false;
    this._domListeners = [];
    this._unsubscribers = [];
    this._debugTimer = null;
    this._liveLine = null;
  }

  mount() {
    if (this._mounted) return false;
    this._mounted = true;
    this._applyPreferences();
    this._mountEmotions();
    this._wireFace();
    this._wireControls();
    this._syncPresentation();
    this._startDebugMetrics();
    return true;
  }

  destroy() {
    if (!this._mounted) return false;
    this._mounted = false;
    for (const [target, type, listener, options] of this._domListeners) {
      target.removeEventListener(type, listener, options);
    }
    this._domListeners.length = 0;
    for (const unsubscribe of this._unsubscribers) unsubscribe();
    this._unsubscribers.length = 0;
    if (this._debugTimer != null) clearInterval(this._debugTimer);
    this._debugTimer = null;
    return true;
  }

  _applyPreferences() {
    const p = this.preferences;
    this.face.setTheme(p.theme);
    this.face.setGeometry(p.geometry);
    this.face.setQuality(p.quality);
    this.face.setMotionPolicy(p.motion);
    this.face.setVisualIntensity(p.visualIntensity);
    const panel = this.$('#console');
    if (panel) {
      panel.dataset.dock = p.dock;
      panel.classList.toggle('collapsed', p.collapsed);
    }
  }

  _mountEmotions() {
    const root = this.$('#emotions');
    if (!root || root.children.length) return;
    for (const name of EMOTION_NAMES) {
      const button = this.root.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = name;
      button.setAttribute('aria-pressed', 'false');
      this._listen(button, 'click', () => this.face.setEmotion(name));
      root.appendChild(button);
    }
  }

  _wireFace() {
    this._onFace('state', ({ state }) => {
      const status = this.$('#status');
      if (status) {
        status.textContent = STATUS_LABEL[state] || String(state).toUpperCase();
        status.dataset.state = state;
      }
      this.$('#listen')?.classList.toggle('active', state === 'listening');
      this._announce(STATUS_LABEL[state] || state);
    });
    this._onFace('provider', ({ name }) => {
      const provider = this.$('#provider');
      if (provider) provider.textContent = `VOICE:${String(name).toUpperCase()}`;
    });
    this._onFace('capabilities', (capabilities) => {
      const listen = this.$('#listen');
      if (listen) {
        listen.disabled = !capabilities.stt;
        listen.title = capabilities.stt ? 'Start microphone listening' : 'Speech recognition unavailable';
      }
      const retry = this.$('#provider-retry');
      if (retry) retry.hidden = !capabilities.retry;
    });
    this._onFace('emotion', ({ emotion }) => {
      for (const chip of this.$('#emotions')?.children || []) {
        const selected = chip.textContent === emotion;
        chip.classList.toggle('active', selected);
        chip.setAttribute('aria-pressed', String(selected));
      }
    });
    this._onFace('transcript', (detail) => this._renderTranscript(detail));
    this._onFace('quality', ({ policy, tier }) => {
      const quality = this.$('#quality');
      if (quality && policy) quality.value = policy;
      this._announce(`Rendering quality ${tier || policy}`);
    });
    this._onFace('visualevent', ({ type, active }) => {
      const event = this.$('#visual-event');
      if (event) event.textContent = active ? type.toUpperCase() : 'FACE STABLE';
    });
    this._onFace('error', ({ message }) => this._announce(`Error: ${message}`));
  }

  _wireControls() {
    const input = this.$('#say-input');
    const submit = async () => {
      const text = input?.value.trim();
      if (!text) return;
      input.value = '';
      await this.face.ask(text);
    };
    this._click('#say-btn', submit);
    this._listen(input, 'keydown', (event) => { if (event.key === 'Enter') submit(); });
    this._click('#listen', async () => {
      if (this.face.state === 'listening') await this.face.stopListening();
      else await this.face.startListening();
    });
    this._click('#interrupt', () => {
      this.onInterrupt?.();
      this.face.interrupt();
    });
    this._click('#mute', () => {
      const button = this.$('#mute');
      this.face.setMuted(!this.face.muted);
      button.textContent = this.face.muted ? 'UNMUTE' : 'MUTE';
      button.classList.toggle('active', this.face.muted);
      button.setAttribute('aria-pressed', String(this.face.muted));
    });
    this._click('#demo', () => this.onDemo?.());
    this._click('#theme-toggle', () => {
      this.face.setTheme(this.face.theme === 'wintermute' ? 'codefall' : 'wintermute');
      this.preferences.theme = this.face.theme;
      this._syncPresentation();
      this._save();
    });
    this._click('#geometry-toggle', () => {
      this.face.toggleGeometry();
      this.preferences.geometry = this.face.geometry;
      this._syncPresentation();
      this._save();
    });
    this._change('#quality', (event) => {
      this.face.setQuality(event.target.value);
      this.preferences.quality = event.target.value;
      this._save();
    });
    this._change('#motion-policy', (event) => {
      this.face.setMotionPolicy(event.target.value);
      this.preferences.motion = event.target.value;
      this._save();
    });
    this._change('#visual-intensity', (event) => {
      const value = Number(event.target.value);
      this.face.setVisualIntensity(value);
      this.preferences.visualIntensity = value;
      this._save();
    });
    this._click('#provider-retry', () => this.face.retryProvider());
    this._click('#snapshot-copy', () => this._copySnapshot());
    this._click('#debug-toggle', () => {
      const debug = this.$('#debug');
      debug?.classList.toggle('open');
      this.$('#debug-toggle')?.setAttribute('aria-expanded', String(debug?.classList.contains('open')));
    });
    this._click('#console-toggle', () => {
      const panel = this.$('#console');
      const collapsed = !panel.classList.contains('collapsed');
      panel.classList.toggle('collapsed', collapsed);
      this.preferences.collapsed = collapsed;
      this._syncPresentation();
      this._save();
    });
    for (const button of this.root.querySelectorAll('.dock-btn')) {
      this._listen(button, 'click', () => {
        this.preferences.dock = button.dataset.dock;
        this.$('#console').dataset.dock = button.dataset.dock;
        this._syncPresentation();
        this._save();
      });
    }
  }

  _renderTranscript({ role, text, final, via }) {
    const transcript = this.$('#transcript');
    if (!transcript) return;
    if (!final && role === 'agent') {
      if (!this._liveLine) {
        this._liveLine = this.root.createElement('div');
        this._liveLine.className = 'line agent';
        transcript.appendChild(this._liveLine);
      }
      this._liveLine.textContent += text;
      return;
    }
    if (this._liveLine && role === 'agent') {
      this._liveLine.textContent = text;
      this._liveLine = null;
    } else if (final) {
      const line = this.root.createElement('div');
      line.className = `line ${role}`;
      line.textContent = text;
      transcript.appendChild(line);
    }
    if (final) this._announce(`${role}: ${text}`);
    if (role === 'user' && final && via !== 'api' && this.face.adapter?.name === 'local') {
      this.face.ask(text);
    }
    transcript.scrollTop = transcript.scrollHeight;
    while (transcript.children.length > 60) transcript.firstChild.remove();
  }

  _syncPresentation() {
    const geometry = this.$('#geometry-toggle');
    if (geometry) {
      const smooth = this.face.geometry === 'smooth';
      geometry.textContent = smooth ? '○' : '◇';
      geometry.setAttribute('aria-pressed', String(smooth));
      geometry.setAttribute('aria-label', `Face geometry: ${this.face.geometry}`);
    }
    const theme = this.$('#theme-toggle');
    if (theme) {
      theme.setAttribute('aria-pressed', String(this.face.theme === 'codefall'));
      theme.setAttribute('aria-label', `Theme: ${this.face.theme}`);
    }
    const panel = this.$('#console');
    const toggle = this.$('#console-toggle');
    if (panel && toggle) {
      const collapsed = panel.classList.contains('collapsed');
      toggle.textContent = collapsed ? '▴' : '▾';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    }
    for (const button of this.root.querySelectorAll('.dock-btn')) {
      const selected = button.dataset.dock === panel?.dataset.dock;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    const quality = this.$('#quality');
    if (quality) quality.value = this.preferences.quality;
    const motion = this.$('#motion-policy');
    if (motion) motion.value = this.preferences.motion;
    const intensity = this.$('#visual-intensity');
    if (intensity) intensity.value = String(this.preferences.visualIntensity);
  }

  async _copySnapshot() {
    const text = JSON.stringify(this.face.getSnapshot(), null, 2);
    try {
      await this.root.defaultView?.navigator?.clipboard?.writeText(text);
      this._announce('Diagnostic snapshot copied');
    } catch {
      this._announce('Snapshot copy unavailable');
    }
  }

  _startDebugMetrics() {
    this._debugTimer = setInterval(() => {
      const target = this.$('#debug-stats');
      if (!target || !this.face.renderer) return;
      const snapshot = this.face.getSnapshot();
      target.textContent = `fps:${snapshot.rendering.fps} ` +
        `grid:${this.face.renderer.cols || 0}×${this.face.renderer.rows || 0} ` +
        `coh:${snapshot.face.coherence.toFixed(2)} event:${snapshot.rendering.visualIntensity.toFixed(2)}`;
    }, 500);
  }

  _announce(message) {
    const live = this.$('#live-status');
    if (live) live.textContent = message;
  }

  _save() { savePreferences(this.storage, this.preferences); }
  $(selector) { return this.root.querySelector(selector); }
  _onFace(type, listener) { this._unsubscribers.push(this.face.on(type, listener)); }
  _click(selector, listener) { this._listen(this.$(selector), 'click', listener); }
  _change(selector, listener) { this._listen(this.$(selector), 'change', listener); }
  _listen(target, type, listener, options) {
    if (!target) return;
    target.addEventListener(type, listener, options);
    this._domListeners.push([target, type, listener, options]);
  }
}
