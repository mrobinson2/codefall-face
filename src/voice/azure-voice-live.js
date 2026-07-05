/**
 * Azure Voice Live adapter — the primary voice path.
 *
 * Azure AI Voice Live is a low-latency bidirectional realtime voice API
 * (WebSocket transport, OpenAI-Realtime-shaped protocol: session.update,
 * input_audio_buffer.append, response.audio.delta, ...).
 *
 * Why a relay? Browsers cannot set the `api-key` / `Authorization`
 * header on a WebSocket, and shipping the key in a query string would
 * publish it. So the client connects to server/server.mjs, which holds
 * the key and pipes frames verbatim in both directions. The relay is
 * ~100 lines and is the ONLY server-side requirement of this project.
 *
 * Audio in : getUserMedia → AudioWorklet downsampler → PCM16 @ 24 kHz
 *            base64 → input_audio_buffer.append
 * Audio out: response.audio.delta base64 PCM16 @ 24 kHz → scheduled
 *            AudioBufferSourceNodes → GainNode (exposed to the
 *            SpeechEngine's analyser, so mouth motion tracks the real
 *            waveform, not a guess).
 *
 * Protocol notes are current as of api-version 2025-05-01-preview; if
 * Microsoft revs the schema, this file and server/.env are the only
 * touch points.
 */

import { VoiceAdapter } from './adapter.js';

const OUT_RATE = 24000;

const WORKLET_SRC = `
class PCMCapture extends AudioWorkletProcessor {
  constructor() { super(); this._acc = []; this._accLen = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Downsample from context rate to 24kHz (linear), pack PCM16.
    const ratio = sampleRate / ${OUT_RATE};
    const outLen = Math.floor(ch.length / ratio);
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const v = Math.max(-1, Math.min(1, ch[Math.floor(i * ratio)]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
`;

export class AzureVoiceLiveAdapter extends VoiceAdapter {
  constructor(config) {
    super(config);
    this.name = 'azure';
    this.capabilities = { tts: true, stt: true, conversational: true };
    this._ws = null;
    this._audioCtx = null;
    this._gain = null;
    this._playHead = 0;
    this._sources = new Set();
    this._micStream = null;
    this._micNode = null;
    this._listening = false;
    this._speaking = false;
    this._speakResolve = null;
  }

  _relayUrl() {
    if (this.config.azure.relayUrl) return this.config.azure.relayUrl;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/relay`;
  }

  async init() {
    await this._connect();
    this._ensureAudio();
    this.emit('ready');
  }

  _connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this._relayUrl());
      const timer = setTimeout(() => {
        if (!settled) { settled = true; ws.close(); reject(new Error('relay timeout')); }
      }, 4000);

      ws.onopen = () => {
        clearTimeout(timer);
        this._ws = ws;
        this._send({
          type: 'session.update',
          session: {
            instructions: this.config.azure.instructions,
            voice: { name: this.config.azure.voice, type: 'azure-standard' },
            turn_detection: { type: 'azure_semantic_vad', threshold: 0.4 },
            input_audio_transcription: { model: 'whisper-1' },
            modalities: ['text', 'audio'],
          },
        });
        if (!settled) { settled = true; resolve(); }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error('relay unreachable')); }
        else this.emit('error', { message: 'Voice Live socket error' });
      };
      ws.onclose = () => {
        this._ws = null;
        this.emit('error', { message: 'Voice Live disconnected', fatal: true });
      };
      ws.onmessage = (e) => this._handle(e.data);
    });
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  _ensureAudio() {
    if (this._audioCtx) return;
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._gain = this._audioCtx.createGain();
    this._gain.connect(this._audioCtx.destination);
    this.emit('audionode', { ctx: this._audioCtx, node: this._gain });
  }

  _handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'response.audio.delta':
        this._playChunk(msg.delta);
        break;
      case 'response.audio_transcript.delta':
        this.emit('transcript', { role: 'agent', text: msg.delta, final: false });
        break;
      case 'response.audio_transcript.done':
        this.emit('transcript', { role: 'agent', text: msg.transcript, final: true });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.emit('transcript', { role: 'user', text: msg.transcript, final: true });
        break;
      case 'input_audio_buffer.speech_started':
        // Barge-in: the human spoke over the ghost.
        this._flushPlayback();
        this.emit('statechange', { state: 'listening' });
        break;
      case 'response.created':
        this.emit('statechange', { state: 'thinking' });
        break;
      case 'response.done':
        this._endSpeechWhenDrained();
        break;
      case 'error':
        this.emit('error', { message: msg.error?.message || 'Voice Live error' });
        break;
    }
  }

  _playChunk(b64) {
    this._ensureAudio();
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length / 2);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    }
    const buf = this._audioCtx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

    const src = this._audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this._gain);
    const now = this._audioCtx.currentTime;
    if (this._playHead < now + 0.02) this._playHead = now + 0.02;
    src.start(this._playHead);
    this._playHead += buf.duration;
    this._sources.add(src);
    src.onended = () => this._sources.delete(src);

    if (!this._speaking) {
      this._speaking = true;
      this.emit('speechstart');
    }
  }

  _endSpeechWhenDrained() {
    const remaining = this._audioCtx
      ? Math.max(0, this._playHead - this._audioCtx.currentTime) : 0;
    setTimeout(() => {
      if (this._speaking) {
        this._speaking = false;
        this.emit('speechend');
        if (this._speakResolve) { this._speakResolve(); this._speakResolve = null; }
      }
    }, remaining * 1000 + 60);
  }

  _flushPlayback() {
    for (const s of this._sources) { try { s.stop(); } catch { /* ok */ } }
    this._sources.clear();
    this._playHead = 0;
    if (this._speaking) {
      this._speaking = false;
      this.emit('speechend');
      if (this._speakResolve) { this._speakResolve(); this._speakResolve = null; }
    }
  }

  /** Say `text` verbatim through the realtime voice. */
  async speak(text, opts = {}) {
    this.interrupt();
    return new Promise((resolve) => {
      this._speakResolve = resolve;
      this._send({
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions:
            (opts.verbatim === false ? '' : 'Say exactly the following, nothing else: ') + text,
        },
      });
    });
  }

  async startListening() {
    if (this._listening) return;
    this._ensureAudio();
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
    this._micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this._audioCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const src = this._audioCtx.createMediaStreamSource(this._micStream);
    const node = new AudioWorkletNode(this._audioCtx, 'pcm-capture');
    node.port.onmessage = (e) => {
      if (!this._listening) return;
      const bytes = new Uint8Array(e.data);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      this._send({ type: 'input_audio_buffer.append', audio: btoa(bin) });
    };
    src.connect(node);
    this._micNode = { src, node };
    this._listening = true;
    this.emit('listeningchange', { listening: true });
  }

  async stopListening() {
    this._listening = false;
    if (this._micNode) {
      try { this._micNode.src.disconnect(); this._micNode.node.disconnect(); } catch { /* ok */ }
      this._micNode = null;
    }
    if (this._micStream) {
      this._micStream.getTracks().forEach((t) => t.stop());
      this._micStream = null;
    }
    this.emit('listeningchange', { listening: false });
  }

  interrupt() {
    this._send({ type: 'response.cancel' });
    this._flushPlayback();
  }

  setMuted(m) {
    this.muted = m;
    if (this._gain) this._gain.gain.value = m ? 0 : 1;
  }

  destroy() {
    this.interrupt();
    this.stopListening();
    if (this._ws) { this._ws.onclose = null; this._ws.close(); this._ws = null; }
    if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
  }
}
