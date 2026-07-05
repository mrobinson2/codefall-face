/**
 * Piper adapter — fully local neural TTS (github.com/rhasspy/piper).
 *
 * The server runs the Piper engine (see server/setup-piper.sh, default
 * voice en_US-danny-low) and streams raw PCM16 from POST /api/tts.
 * Because playback goes through Web Audio — unlike the browser's sealed
 * speechSynthesis — this path gets everything the Azure path gets, with
 * no cloud and no keys:
 *
 *   - the ghost FX chain (ring-mod robot treatment, config.voiceFx)
 *   - waveform-accurate mouth animation via the analyser
 *
 * STT still comes from webkitSpeechRecognition (inherited), so LISTEN
 * works wherever the browser supports it.
 */

import { LocalSpeechAdapter } from './local-speech.js';
import { attachGhostFx } from './voice-fx.js';

export class PiperAdapter extends LocalSpeechAdapter {
  constructor(config) {
    super(config);
    this.name = 'piper';
    this._audioCtx = null;
    this._gain = null;
    this._source = null;
  }

  async init() {
    const res = await fetch('/api/tts/health').catch(() => null);
    if (!res || !res.ok) {
      throw new Error('Piper TTS not available — run server/setup-piper.sh');
    }
    this.capabilities.tts = true;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.capabilities.stt = !!SR;
    this._SR = SR;
    this.emit('ready');
  }

  _ensureAudio() {
    if (this._audioCtx) return;
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._gain = this._audioCtx.createGain();
    let tail = this._gain;
    const fx = this.config.voiceFx;
    if (fx?.enabled) tail = attachGhostFx(this._audioCtx, this._gain, fx);
    tail.connect(this._audioCtx.destination);
    this.emit('audionode', { ctx: this._audioCtx, node: tail });
  }

  async speak(text, _opts = {}) {
    this.interrupt();
    if (this.muted) return this._speakSilently(text);

    this._ensureAudio();
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      this.emit('error', { message: `Piper TTS failed (${res.status})` });
      return;
    }
    const rate = Number(res.headers.get('X-Sample-Rate')) || 16000;
    const raw = await res.arrayBuffer();
    if (raw.byteLength < 2) return;

    const pcm = new Int16Array(raw);
    const buf = this._audioCtx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

    return new Promise((resolve) => {
      const src = this._audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this._gain);
      this._source = src;
      this.emit('speechstart');
      src.onended = () => {
        if (this._source === src) this._source = null;
        this.emit('speechend');
        resolve();
      };
      src.start();
    });
  }

  interrupt() {
    if (this._silent) { clearTimeout(this._silent); this._silent = null; this.emit('speechend'); }
    if (this._source) {
      const src = this._source;
      this._source = null;
      try { src.stop(); } catch { /* already stopped */ }
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this._gain) this._gain.gain.value = m ? 0 : 1;
  }

  destroy() {
    this.interrupt();
    this._stopRec();
    if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
  }
}
