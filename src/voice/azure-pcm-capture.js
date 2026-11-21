const OUTPUT_RATE = 24000;
const CHUNK_SAMPLES = 960; // 40 ms of mono audio at 24 kHz.

class AzurePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samplesPerOutput = sampleRate / OUTPUT_RATE;
    this.remaining = this.samplesPerOutput;
    this.sum = 0;
    this.chunk = new ArrayBuffer(CHUNK_SAMPLES * 2);
    this.pcm = new DataView(this.chunk);
    this.index = 0;
  }

  process(inputs) {
    const mono = inputs[0]?.[0];
    if (!mono) return true;

    // Average each output interval and carry partial intervals between
    // render blocks. Dropping the remainder skews the rate at 44.1 kHz.
    for (const sample of mono) {
      let fraction = 1;
      while (fraction > 1e-8) {
        const step = Math.min(this.remaining, fraction);
        fraction -= step;
        this.remaining -= step;
        this.sum += sample * step;
        if (this.remaining > 1e-8) continue;

        const value = Math.max(-1, Math.min(1, this.sum / this.samplesPerOutput));
        this.pcm.setInt16(this.index * 2, value * (value < 0 ? 32768 : 32767), true);
        this.index++;
        if (this.index === CHUNK_SAMPLES) {
          this.port.postMessage(this.chunk, [this.chunk]);
          this.chunk = new ArrayBuffer(CHUNK_SAMPLES * 2);
          this.pcm = new DataView(this.chunk);
          this.index = 0;
        }
        this.remaining = this.samplesPerOutput;
        this.sum = 0;
      }
    }
    return true;
  }
}

registerProcessor('azure-pcm-capture', AzurePcmCapture);
