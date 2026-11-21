import { VoiceAdapter } from './adapter.js';
import { attachGhostFx } from './voice-fx.js';

const RATE = 24000;
const MAX_TEXT = 4000;
const MAX_AUDIO_BACKLOG = 256 * 1024;
const HANDSHAKE_MS = 10000;
const RESPONSE_MS = 60000;

function inputText(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
    throw new Error('Enter between 1 and 4000 characters.');
  }
  return text.trim();
}

export class AzureVoiceLiveAdapter extends VoiceAdapter {
  constructor(config) {
    super(config);
    this.name = 'azure';
    this.capabilities = {
      tts: true, stt: true, conversational: true, waveform: true, retry: true,
    };
    this._ws = null;
    this._connection = null;
    this._failConnection = null;
    this._ready = false;
    this._instructions = config.azure?.instructions;
    this._audioCtx = null;
    this._audioAnnounced = false;
    this._gain = null;
    this._output = null;
    this._fx = null;
    this._playHead = 0;
    this._sources = new Set();
    this._speaking = false;
    this._drainTimer = null;
    this._turn = null;
    this._ignoredResponses = new Set();
    this._ignoreNextCreated = false;
    this._listening = false;
    this._mic = null;
    this._micGeneration = 0;
    this._micStart = null;
    this._worklet = null;
  }

  _relayUrl() {
    if (this.config.azure?.relayUrl) return this.config.azure.relayUrl;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/relay`;
  }

  init() {
    if (this._destroyed) return Promise.reject(new Error('Voice session is closed.'));
    if (!this._connection) {
      this._connection = this._connect().then(() => {
        // The 2D provider manager registers listeners after init resolves.
        this._ensureAudio(false);
        this.emit('ready');
      }).catch(error => {
        this._disposeSocket();
        this._connection = null;
        throw error;
      });
    }
    return this._connection;
  }

  _session() {
    return {
      instructions: this._instructions,
      voice: { name: this.config.azure?.voice || 'en-US-AndrewMultilingualNeural', type: 'azure-standard' },
      modalities: ['text', 'audio'],
      input_audio_format: 'pcm16',
      input_audio_sampling_rate: RATE,
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: this.config.azure?.transcriptionModel || 'whisper-1' },
      turn_detection: { type: 'azure_semantic_vad', threshold: 0.45, create_response: true, interrupt_response: true },
    };
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const ws = this._ws = new WebSocket(this._relayUrl());
      let configured = false;
      const fail = (error) => {
        clearTimeout(timer);
        this._failConnection = null;
        this._disposeSocket();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('Azure Voice Live did not confirm the session in time.')), HANDSHAKE_MS);
      this._failConnection = fail;
      ws.onmessage = ({ data }) => {
        let message;
        try { message = JSON.parse(data); } catch { return; }
        if (!message || typeof message.type !== 'string') return;

        if (!this._ready) {
          if (message.type === 'session.created' && !configured) {
            configured = true;
            this._send({ type: 'session.update', session: this._session() });
          } else if (message.type === 'session.updated' && configured) {
            clearTimeout(timer);
            this._failConnection = null;
            this._ready = true;
            resolve();
          } else if (message.type === 'error') {
            fail(new Error(message.error?.message || 'Azure Voice Live refused the session.'));
          }
          return;
        }
        this._handle(message);
      };
      ws.onerror = () => {
        const error = new Error('Could not connect to Azure Voice Live.');
        if (!this._ready) fail(error);
        else this._disconnect(error.message);
      };
      ws.onclose = () => {
        if (!this._ready) fail(new Error('Azure Voice Live closed before the session was ready.'));
        else this._disconnect('Azure Voice Live disconnected.');
      };
    });
  }

  _disposeSocket() {
    const ws = this._ws;
    this._ws = null;
    this._ready = false;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch { /* already closed */ }
  }

  _disconnect(message) {
    this._disposeSocket();
    this._connection = null;
    this._ignoreNextCreated = false;
    this._ignoredResponses.clear();
    this.stopListening();
    this._flushPlayback();
    this._finishTurn(new Error(message));
    this.emit('error', { message, fatal: true });
  }

  _send(obj) {
    if (this._ws?.readyState !== WebSocket.OPEN) return false;
    this._ws.send(JSON.stringify(obj));
    return true;
  }

  _requireReady() {
    if (!this._ready || this._ws?.readyState !== WebSocket.OPEN || this._destroyed) {
      throw new Error('Connect to Azure Voice Live first.');
    }
  }

  /** Call from the user's click/key gesture before awaiting a network request. */
  async unlockAudio() {
    this._ensureAudio();
    if (this._audioCtx.state === 'suspended' || this._audioCtx.state === 'interrupted') {
      await this._audioCtx.resume();
    }
  }

  _ensureAudio(announce = true) {
    if (this._destroyed) throw new Error('Voice session is closed.');
    if (!this._audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support Web Audio.');
      this._audioCtx = new AudioContext();
      this._gain = this._audioCtx.createGain();
      this._gain.gain.value = this.muted ? 0 : 1;
      const fx = this.config.voiceFx;
      if (fx?.enabled) this._fx = attachGhostFx(this._audioCtx, this._gain, fx);
      this._output = this._fx?.output || this._gain;
      this._output.connect(this._audioCtx.destination);
    }
    if (announce && !this._audioAnnounced) {
      this._audioAnnounced = true;
      this.emit('audionode', { ctx: this._audioCtx, node: this._output });
    }
  }

  updateInstructions(instructions) {
    this._instructions = inputText(instructions);
    if (this._ready) this._send({ type: 'session.update', session: { instructions: this._instructions } });
  }

  async ask(text) {
    this._requireReady();
    text = inputText(text);
    return this._requestResponse({ type: 'response.create' }, {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    });
  }

  async speak(text, opts = {}) {
    this._requireReady();
    text = inputText(text);
    if (this._turn) this.interrupt();
    const response = opts.verbatim === false
      ? { instructions: text }
      : { pre_generated_assistant_message: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text }],
      } };
    return this._requestResponse({ type: 'response.create', response });
  }

  _requestResponse(request, preceding) {
    if (this._turn) throw new Error('Wait for the current reply or interrupt it first.');
    return new Promise((resolve, reject) => {
      const turn = this._beginTurn({ resolve, reject });
      this.emit('statechange', { state: 'thinking' });
      try {
        if (preceding && !this._send(preceding)) throw new Error('Azure Voice Live disconnected.');
        if (!this._send(request)) throw new Error('Azure Voice Live disconnected.');
      } catch (error) {
        if (this._turn === turn) this._finishTurn(error);
      }
    });
  }

  _beginTurn(callbacks = {}) {
    const turn = {
      ...callbacks,
      id: null,
      done: false,
      hasAudioTranscript: false,
      text: '',
      playback: null,
      timer: setTimeout(() => {
        this._cancelResponse(new Error('Azure Voice Live did not finish the reply in time.'));
        this.emit('error', { message: 'Azure Voice Live did not finish the reply in time.' });
      }, RESPONSE_MS),
    };
    this._turn = turn;
    return turn;
  }

  _emitTranscript(role, text, final, itemId) {
    if (typeof text === 'string' && text) this.emit('transcript', { role, text, final, itemId });
  }

  _handle(message) {
    const turn = this._turn;
    const id = message.response_id || message.response?.id;
    if (id && this._ignoredResponses.has(id)) {
      if (message.type === 'response.done') this._ignoredResponses.delete(id);
      return;
    }
    if (id && turn?.id && turn.id !== id && message.type !== 'response.created') return;

    switch (message.type) {
      case 'response.created': {
        if (this._ignoreNextCreated) {
          this._ignoreNextCreated = false;
          this._ignoreResponse(id);
          break;
        }
        if (id && turn?.id && turn.id !== id) {
          // A new server turn can follow a reply whose last samples are still queued.
          this._ignoreResponse(turn.id);
          this._flushPlayback();
          this._finishTurn();
        }
        const current = this._turn || this._beginTurn();
        current.id = id;
        this.emit('statechange', { state: 'thinking' });
        break;
      }
      case 'response.audio.delta':
        if (turn && !turn.done) this._playChunk(message);
        break;
      case 'response.audio_transcript.delta':
      case 'response.audio_transcript.done': {
        if (!turn) break;
        turn.hasAudioTranscript = true;
        const final = message.type.endsWith('.done');
        this._emitTranscript('agent', final ? message.transcript : message.delta, final, message.item_id);
        break;
      }
      case 'response.text.delta':
        if (turn && typeof message.delta === 'string') turn.text += message.delta;
        break;
      case 'response.text.done':
        if (turn && typeof message.text === 'string') turn.text = message.text;
        break;
      case 'conversation.item.input_audio_transcription.delta':
        this._emitTranscript('user', message.delta, false, message.item_id);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this._emitTranscript('user', message.transcript, true, message.item_id);
        break;
      case 'conversation.item.input_audio_transcription.failed':
        this.emit('error', { message: message.error?.message || 'Azure speech recognition failed.' });
        break;
      case 'input_audio_buffer.speech_started':
        // Server VAD cancels generation. Stop local audio immediately and disregard late chunks.
        this._cancelResponse(null, false);
        if (this._listening) this.emit('statechange', { state: 'listening' });
        break;
      case 'input_audio_buffer.speech_stopped':
        if (this._listening) this.emit('statechange', { state: 'thinking' });
        break;
      case 'response.done':
        if (!turn) break;
        turn.done = true;
        clearTimeout(turn.timer);
        if (!turn.hasAudioTranscript) this._emitTranscript('agent', turn.text, true, undefined);
        if (message.response?.status === 'failed') {
          const error = new Error(message.response.status_details?.error?.message || 'Azure Voice Live could not generate the reply.');
          this._flushPlayback();
          this._finishTurn(error);
          this.emit('error', { message: error.message });
        } else {
          const delay = this._audioCtx?.state === 'running'
            ? Math.max(0, this._playHead - this._audioCtx.currentTime) * 1000 : 0;
          if (delay > 0) {
            this._drainTimer = setTimeout(() => this._finishTurn(), delay + 35);
          } else {
            if (this._sources.size) this._flushPlayback();
            this._finishTurn();
          }
        }
        break;
      case 'error': {
        const info = message.error;
        if (info?.code === 'response_cancel_not_active' || /no active response/i.test(info?.message || '')) {
          this._ignoreNextCreated = false;
          break;
        }
        const error = new Error(info?.message || 'Azure Voice Live reported an error.');
        if (turn) {
          this._flushPlayback();
          this._finishTurn(error);
        }
        this.emit('error', { message: error.message });
        break;
      }
    }
  }

  _playChunk({ delta, item_id, content_index }) {
    if (typeof delta !== 'string' || !delta) return;
    let pcm;
    try { pcm = atob(delta); } catch { return; }
    if (!pcm.length || pcm.length % 2) return;
    this._ensureAudio();
    const audio = this._audioCtx;
    const buffer = audio.createBuffer(1, pcm.length / 2, RATE);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const sample = pcm.charCodeAt(i * 2) | (pcm.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (sample >= 32768 ? sample - 65536 : sample) / 32768;
    }

    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(this._gain);
    this._playHead = Math.max(this._playHead, audio.currentTime + 0.025);
    const turn = this._turn;
    if (turn.playback?.itemId !== item_id || !turn.playback) {
      turn.playback = { itemId: item_id, contentIndex: content_index ?? 0, starts: this._playHead, duration: 0 };
    }
    turn.playback.duration += buffer.duration;
    source.start(this._playHead);
    this._playHead += buffer.duration;
    this._sources.add(source);
    source.onended = () => {
      this._sources.delete(source);
      source.disconnect();
      if (turn === this._turn && turn.done && !this._sources.size) this._finishTurn();
    };

    if (!this._speaking) {
      this._speaking = true;
      this.emit('speechstart');
      this.emit('statechange', { state: 'speaking' });
    }
  }

  _finishTurn(error) {
    const turn = this._turn;
    this._turn = null;
    clearTimeout(turn?.timer);
    clearTimeout(this._drainTimer);
    this._drainTimer = null;
    if (this._speaking) {
      this._speaking = false;
      this.emit('speechend');
    }
    if (turn) this.emit('statechange', { state: this._listening ? 'listening' : 'idle' });
    if (error) turn?.reject?.(error);
    else turn?.resolve?.();
  }

  _flushPlayback() {
    for (const source of this._sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this._sources.clear();
    this._playHead = 0;
  }

  _ignoreResponse(id) {
    if (!id) return;
    this._ignoredResponses.add(id);
    if (this._ignoredResponses.size > 32) {
      this._ignoredResponses.delete(this._ignoredResponses.values().next().value);
    }
  }

  _cancelResponse(error, notifyServer = true) {
    const turn = this._turn;
    if (turn && !turn.done) {
      this._ignoreNextCreated ||= !turn.id;
      this._ignoreResponse(turn.id);
      if (notifyServer) this._send({ type: 'response.cancel' });
    }
    const playback = turn?.playback;
    if (playback?.itemId && this._audioCtx) {
      const played = Math.max(0, this._audioCtx.currentTime - playback.starts);
      if (played < playback.duration) {
        this._send({
          type: 'conversation.item.truncate',
          item_id: playback.itemId,
          content_index: playback.contentIndex,
          audio_end_ms: Math.floor(played * 1000),
        });
      }
    }
    this._flushPlayback();
    this._finishTurn(error);
  }

  interrupt() {
    this._cancelResponse();
  }

  startListening() {
    try { this._requireReady(); } catch (error) { return Promise.reject(error); }
    if (this._listening) return Promise.resolve();
    if (this._micStart) return this._micStart;
    const generation = ++this._micGeneration;
    const starting = this._startMicrophone(generation).finally(() => {
      if (this._micStart === starting) this._micStart = null;
    });
    this._micStart = starting;
    return starting;
  }

  async _startMicrophone(generation) {
    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) throw new Error('Microphone capture needs HTTPS or localhost.');
    await this.unlockAudio();
    if (generation !== this._micGeneration) return;
    const audio = this._audioCtx;
    if (!audio.audioWorklet) throw new Error('This browser does not support microphone audio worklets.');
    let stream;
    try {
      stream = await devices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      if (generation === this._micGeneration) throw error;
      return;
    }
    let src;
    let node;
    let sink;
    try {
      if (generation !== this._micGeneration) return;
      if (!this._worklet) {
        const url = this.config.azure?.workletUrl || new URL('./azure-pcm-capture.js', import.meta.url).href;
        this._worklet = audio.audioWorklet.addModule(url).catch(error => {
          this._worklet = null;
          throw error;
        });
      }
      await this._worklet;
      if (generation !== this._micGeneration) return;
      src = audio.createMediaStreamSource(stream);
      node = new AudioWorkletNode(audio, 'azure-pcm-capture');
      // Keep the graph running without feeding the microphone back to speakers.
      sink = audio.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(audio.destination);
      src.connect(node);
      node.port.onmessage = ({ data }) => {
        if (!this._listening || generation !== this._micGeneration) return;
        if (this._ws?.bufferedAmount > MAX_AUDIO_BACKLOG) {
          this._disconnect('The voice connection could not keep up with the microphone.');
          return;
        }
        const audio = btoa(String.fromCharCode(...new Uint8Array(data)));
        this._send({ type: 'input_audio_buffer.append', audio });
      };
      this._mic = { stream, src, node, sink };
      this._listening = true;
      this.emit('listeningchange', { listening: true });
      if (!this._turn) this.emit('statechange', { state: 'listening' });
    } finally {
      if (this._mic?.stream !== stream) {
        src?.disconnect();
        node?.disconnect();
        sink?.disconnect();
        for (const track of stream.getTracks()) track.stop();
      }
    }
  }

  async stopListening() {
    ++this._micGeneration;
    this._micStart = null;
    const mic = this._mic;
    this._mic = null;
    if (!mic) return;
    this._listening = false;
    mic.node.port.onmessage = null;
    mic.node.port.close();
    mic.src.disconnect();
    mic.node.disconnect();
    mic.sink.disconnect();
    for (const track of mic.stream.getTracks()) track.stop();
    this._send({ type: 'input_audio_buffer.clear' });
    this.emit('listeningchange', { listening: false });
    if (!this._turn) this.emit('statechange', { state: 'idle' });
  }

  setMuted(muted) {
    this.muted = muted;
    if (this._gain) this._gain.gain.value = muted ? 0 : 1;
  }

  destroy() {
    if (!super.destroy()) return false;
    this._failConnection?.(new Error('Voice session is closed.'));
    this.interrupt();
    this.stopListening();
    this._disposeSocket();
    this._fx?.destroy();
    this._gain?.disconnect();
    this._audioCtx?.close().catch(() => {});
    this._audioCtx = this._gain = this._output = null;
    this._worklet = this._fx = null;
    return true;
  }
}
