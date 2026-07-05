/**
 * Ghost voice FX — Web Audio post-processing for provider audio.
 *
 * The chain: dry/wet ring modulator → soft-clip waveshaper → band
 * shaping (highpass + lowpass). Ring modulation at ~30 Hz is the
 * classic mechanical-voice treatment (it's how the Daleks were made);
 * the band-limiting reads as "signal arriving through a wire".
 *
 * Only providers that play audio through an AudioContext can be
 * processed (Azure Voice Live). Web Speech synthesis never exposes an
 * audio node, so the local voice can't take FX — its ghostliness comes
 * from voice choice + pitch instead.
 */

export function attachGhostFx(ctx, input, opts = {}) {
  const {
    ringHz = 30,
    ringDepth = 0.35,
    lowpassHz = 3400,
    highpassHz = 220,
  } = opts;

  // Ring modulator: wet path multiplied by a sine, mixed with dry.
  const dry = ctx.createGain();
  dry.gain.value = 1 - ringDepth;
  const wet = ctx.createGain();
  wet.gain.value = 0; // driven by the oscillator
  const osc = ctx.createOscillator();
  osc.frequency.value = ringHz;
  const oscAmp = ctx.createGain();
  oscAmp.gain.value = ringDepth;
  osc.connect(oscAmp);
  oscAmp.connect(wet.gain);
  osc.start();

  // Gentle saturation so peaks fuzz instead of clip.
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 127.5) - 1;
    curve[i] = Math.tanh(x * 1.8);
  }
  shaper.curve = curve;
  shaper.oversample = '2x';

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpassHz;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = lowpassHz;

  const out = ctx.createGain();

  input.connect(dry);
  input.connect(wet);
  dry.connect(shaper);
  wet.connect(shaper);
  shaper.connect(hp);
  hp.connect(lp);
  lp.connect(out);

  return out;
}
