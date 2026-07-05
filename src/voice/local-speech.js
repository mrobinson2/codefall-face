/**
 * Local adapter — Web Speech API. Zero backend, zero credentials.
 *
 * TTS: speechSynthesis with word-boundary events feeding the syllable
 * oscillator (iOS Safari fires boundary events inconsistently, so a
 * heartbeat pulse keeps the mouth moving while speaking).
 *
 * STT: webkitSpeechRecognition where available (Chrome desktop/Android;
 * Safari/iOS support varies by version and Siri settings — feature
 * detected, degrades gracefully).
 *
 * This adapter is what makes the repo runnable in one command with no
 * accounts, and is the engine behind demo mode.
 */

import { VoiceAdapter } from './adapter.js';

export class LocalSpeechAdapter extends VoiceAdapter {
  constructor(config) {
    super(config);
    this.name = 'local';
    this._utterance = null;
    this._recognition = null;
    this._heartbeat = null;
    this._voice = null;
  }

  async init() {
    if (!('speechSynthesis' in window)) {
      throw new Error('Web Speech synthesis unavailable');
    }
    this.capabilities.tts = true;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.capabilities.stt = !!SR;
    this._SR = SR;

    // Voice lists load async in most browsers.
    await new Promise((resolve) => {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        if (!voices.length) return false;
        const prefs = this.config.local.preferredVoices;
        this._voice =
          voices.find((v) => prefs.some((p) => v.name.includes(p))) ||
          voices.find((v) => v.lang.startsWith('en')) ||
          voices[0];
        resolve();
        return true;
      };
      if (!pick()) {
        speechSynthesis.onvoiceschanged = pick;
        setTimeout(resolve, 1500); // don't hang if the event never fires
      }
    });
    this.emit('ready');
  }

  async speak(text, opts = {}) {
    this.interrupt();
    if (this.muted) {
      // Muted: still animate — fake pulses paced like real speech.
      return this._speakSilently(text, opts);
    }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (this._voice) u.voice = this._voice;
      u.rate = this.config.local.rate;
      u.pitch = this.config.local.pitch;
      this._utterance = u;

      u.onstart = () => {
        this.emit('speechstart');
        // Heartbeat: guarantees motion even if boundary events don't fire.
        this._heartbeat = setInterval(
          () => this.emit('pulse', { level: 0.5 + Math.random() * 0.4, length: 4 }),
          140
        );
      };
      u.onboundary = (e) => {
        const len = e.charLength || 4;
        this.emit('pulse', { level: 0.6 + Math.random() * 0.4, length: len });
      };
      const done = () => {
        clearInterval(this._heartbeat);
        this._heartbeat = null;
        this._utterance = null;
        this.emit('speechend');
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }

  /** Animate speech without audio (mute / demo without voices). */
  _speakSilently(text) {
    return new Promise((resolve) => {
      this.emit('speechstart');
      const words = text.split(/\s+/);
      let i = 0;
      const step = () => {
        if (i >= words.length || !this._silent) {
          this._silent = null;
          this.emit('speechend');
          return resolve();
        }
        this.emit('pulse', { level: 0.55 + Math.random() * 0.45, length: words[i].length });
        i++;
        this._silent = setTimeout(step, 90 + words[i - 1].length * 42);
      };
      this._silent = setTimeout(step, 10);
    });
  }

  async startListening() {
    if (!this._SR) {
      this.emit('error', { message: 'Speech recognition unavailable in this browser' });
      return;
    }
    if (this._recognition) return;
    const rec = new this._SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        this.emit('transcript', {
          role: 'user',
          text: res[0].transcript.trim(),
          final: res.isFinal,
        });
      }
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.emit('error', { message: `STT: ${e.error}` });
      }
    };
    rec.onend = () => {
      // Auto-restart while listening is intended (Chrome times out).
      if (this._recognition === rec) {
        try { rec.start(); } catch { this._stopRec(); }
      }
    };
    this._recognition = rec;
    rec.start();
    this.emit('listeningchange', { listening: true });
  }

  _stopRec() {
    const rec = this._recognition;
    this._recognition = null;
    if (rec) { try { rec.stop(); } catch { /* ok */ } }
    this.emit('listeningchange', { listening: false });
  }

  async stopListening() { this._stopRec(); }

  interrupt() {
    if (this._silent) { clearTimeout(this._silent); this._silent = null; this.emit('speechend'); }
    if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; }
    if (this._utterance || speechSynthesis.speaking) {
      this._utterance = null;
      speechSynthesis.cancel();
      this.emit('speechend');
    }
  }

  destroy() {
    this.interrupt();
    this._stopRec();
  }
}
