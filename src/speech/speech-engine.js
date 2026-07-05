/**
 * Speech-to-Face Engine.
 *
 * Converts whatever speech signal is available into the dynamic values
 * the face model consumes:
 *
 *   open    — mouth aperture (jaw drop)      0..1
 *   wide    — lip spread                     0..1
 *   tension — lip-line sharpness             0..1
 *   energy  — overall vocal turbulence       0..1
 *
 * Three input tiers, best available wins:
 *  1. Real audio (Azure Voice Live playback, or any AudioNode): an
 *     AnalyserNode gives RMS for `open`/`energy` and a spectral tilt
 *     (high-band vs low-band ratio) for `wide`/`tension` — a cheap,
 *     believable viseme substitute (sibilants spread lips, vowels round).
 *  2. Text pulses (Web Speech boundary events): a syllable oscillator
 *     seeded per word.
 *  3. Fake envelopes (demo mode): scripted pulses, no audio at all.
 */

export class SpeechEngine {
  constructor() {
    this.out = { open: 0, wide: 0, tension: 0, energy: 0 };
    this._target = { open: 0, wide: 0, tension: 0, energy: 0 };
    this._analyser = null;
    this._freqData = null;
    this._timeData = null;
    this._speaking = false;
    this._pulseT = 0;
    this._pulseLevel = 0;
    this._osc = 0;
  }

  /** Tier 1: attach a Web Audio node (TTS playback or any source). */
  attachAnalyser(audioCtx, sourceNode) {
    this.detach();
    this._analyser = audioCtx.createAnalyser();
    this._analyser.fftSize = 512;
    this._analyser.smoothingTimeConstant = 0.5;
    sourceNode.connect(this._analyser);
    this._freqData = new Uint8Array(this._analyser.frequencyBinCount);
    this._timeData = new Uint8Array(this._analyser.fftSize);
  }

  detach() {
    if (this._analyser) {
      try { this._analyser.disconnect(); } catch { /* already gone */ }
    }
    this._analyser = null;
  }

  setSpeaking(on) {
    this._speaking = on;
    if (!on) {
      this._target.open = 0;
      this._target.energy = 0;
      this._pulseLevel = 0;
    }
  }

  /** Tier 2: word-boundary pulse (Web Speech). Longer words → longer burst. */
  textPulse(wordLength = 4) {
    this._pulseT = Math.min(0.9, 0.12 + wordLength * 0.045);
    this._pulseLevel = 0.55 + Math.random() * 0.45;
  }

  /** Tier 3: raw demo-mode pulse. */
  fakePulse(level, duration = 0.15) {
    this._pulseT = duration;
    this._pulseLevel = level;
  }

  tick(dt) {
    const T = this._target;

    if (this._analyser && this._speaking) {
      // ---- real audio analysis ----
      this._analyser.getByteTimeDomainData(this._timeData);
      let sum = 0;
      for (let i = 0; i < this._timeData.length; i += 4) {
        const v = (this._timeData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / (this._timeData.length / 4));
      const level = Math.min(1, rms * 5.5);

      this._analyser.getByteFrequencyData(this._freqData);
      const n = this._freqData.length;
      let low = 0, high = 0;
      const split = (n * 0.18) | 0;
      for (let i = 2; i < split; i++) low += this._freqData[i];
      for (let i = split; i < n * 0.7; i++) high += this._freqData[i];
      low /= Math.max(1, split - 2);
      high /= Math.max(1, (n * 0.7 - split) | 0);
      const tilt = high / Math.max(8, low); // >~0.5 = sibilant-ish

      T.open = level;
      T.energy = level;
      T.wide = Math.min(1, tilt * 1.4);
      T.tension = Math.min(1, tilt * 1.8);
    } else if (this._speaking && this._pulseT > 0) {
      // ---- pulse-driven syllable oscillator ----
      this._pulseT -= dt;
      this._osc += dt * (9 + this._pulseLevel * 8);
      const syll = 0.5 + 0.5 * Math.sin(this._osc);
      T.open = this._pulseLevel * (0.35 + 0.65 * syll);
      T.energy = this._pulseLevel * 0.8;
      T.wide = 0.3 + 0.4 * Math.abs(Math.sin(this._osc * 0.37));
      T.tension = 0.4;
    } else if (this._speaking) {
      // Between pulses: settle toward closed but keep micro-motion
      T.open *= 0.6; T.energy *= 0.7;
    }

    // Fast attack, slower release — speech reads as intentional
    const o = this.out;
    for (const k of ['open', 'wide', 'tension', 'energy']) {
      const rate = T[k] > o[k] ? 22 : 8;
      o[k] += (T[k] - o[k]) * Math.min(1, rate * dt);
    }
  }
}
