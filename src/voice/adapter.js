/**
 * Voice Adapter Layer — provider-agnostic contract.
 *
 * Every provider implements this interface and communicates only
 * through events, so the face/controller never knows which backend is
 * talking. Events:
 *
 *   'ready'            — adapter usable
 *   'statechange'      — { state } idle|listening|thinking|speaking
 *   'speechstart'      — TTS audio began
 *   'speechend'        — TTS audio finished (or was cancelled)
 *   'pulse'            — { level, length } word/syllable timing hint
 *   'audionode'        — { ctx, node } live AudioNode for real analysis
 *   'transcript'       — { role: 'user'|'agent', text, final }
 *   'listeningchange'  — { listening }
 *   'error'            — { message, fatal }
 */

export class VoiceAdapter extends EventTarget {
  constructor(config) {
    super();
    this.config = config;
    this.name = 'base';
    this.muted = false;
    this.capabilities = { tts: false, stt: false, conversational: false };
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Resolve when the adapter is usable; reject if not viable here. */
  async init() {}

  /** Speak `text` aloud. Resolves when speech ends or is interrupted. */
  async speak(_text, _opts = {}) {
    throw new Error(`${this.name}: speak() not implemented`);
  }

  /** Begin microphone capture / STT if supported. */
  async startListening() {
    this.emit('error', { message: `${this.name}: listening not supported` });
  }

  async stopListening() {}

  /** Hard-stop any in-flight speech. */
  interrupt() {}

  setMuted(m) { this.muted = m; }

  destroy() {}
}
