import { EMOTIONS, NEUTRAL, blendParams } from '../face/emotions.js';
import { FaceStateMachine } from './state-machine.js';
import { GazeController } from './gaze-controller.js';
import { VisualEventScheduler } from './visual-event-scheduler.js';

export class FaceRuntime extends EventTarget {
  constructor({ config, speech, streams, rows = 1 }) {
    super();
    this.config = config;
    this.speech = speech;
    this.streams = streams;
    this.rows = rows;
    this.machine = new FaceStateMachine('booting');
    this.emotion = 'neutral';
    this.params = { ...NEUTRAL };
    this.coherence = 0;
    this.targetCoherence = 1;
    this.time = 0;
    this.interruptRemaining = 0;
    this.reducedMotion = config.face.reducedMotion === true;
    this.gaze = new GazeController({
      gazeRandom: streams.gaze,
      blinkRandom: streams.blink,
    });
    this.events = new VisualEventScheduler({
      random: streams.events,
      intensity: config.face.visualIntensity ?? 0.65,
    });
    this.frame = {
      mode: 'booting',
      params: this.params,
      dyn: {
        t: 0, coherence: 0, gazeX: 0, gazeY: 0, blink: 1,
        mouthOpen: 0, mouthWide: 0, tension: 0, energy: 0,
        swayX: 0, swayY: 0,
      },
      visualEvent: this.events.output,
    };
    this._visualPhase = 'none:idle';
    this.machine.addEventListener('change', (event) => {
      this.frame.mode = event.detail.state;
      this.dispatchEvent(new CustomEvent('state', { detail: event.detail }));
    });
    this.machine.addEventListener('diagnostic', (event) => {
      this.dispatchEvent(new CustomEvent('diagnostic', { detail: event.detail }));
    });
  }

  get state() { return this.machine.state; }

  command(command) {
    if (this.state === 'destroyed' || !command || typeof command.type !== 'string') return false;
    switch (command.type) {
      case 'emotion':
        if (!EMOTIONS[command.value]) return false;
        this.emotion = command.value;
        return true;
      case 'provider-state': {
        const next = command.value;
        if (!['idle', 'listening', 'thinking', 'speaking', 'error'].includes(next)) return false;
        if (this.state === 'booting' && next !== 'idle') this.machine.transition('idle');
        this.speech.setSpeaking(next === 'speaking');
        return this.machine.transition(next) || this.state === next;
      }
      case 'interrupt':
        if (this.state === 'booting') this.machine.transition('idle');
        this.speech.setSpeaking(false);
        this.coherence = Math.min(this.coherence, 0.45);
        this.frame.dyn.coherence = this.coherence;
        this.interruptRemaining = 0.7;
        return this.machine.transition('interrupted');
      case 'coherence':
        if (!Number.isFinite(command.value)) return false;
        this.targetCoherence = Math.max(0, Math.min(1, command.value));
        return true;
      case 'reduced-motion':
        this.reducedMotion = !!command.value;
        return true;
      case 'visual-intensity':
        return this.events.setIntensity(command.value);
      case 'pause': return this.machine.pause();
      case 'resume': return this.machine.resume();
      default: return false;
    }
  }

  tick(dt) {
    if (this.state === 'destroyed' || this.state === 'paused') return this.frame;
    dt = Math.max(0, Number(dt) || 0);
    this.time += dt;

    const bootDuration = Math.max(0.5, this.config.face.bootDuration || 4);
    const rate = this.state === 'booting' ? (1 / bootDuration) * 1.6 : 2.2;
    this.coherence += (this.targetCoherence - this.coherence) * Math.min(1, rate * dt);
    if (this.state === 'booting' && this.coherence > 0.92) this.machine.transition('idle');

    if (this.state === 'interrupted') {
      this.interruptRemaining -= dt;
      if (this.interruptRemaining <= 0) this.machine.transition('idle');
    }

    blendParams(this.params, EMOTIONS[this.emotion], dt);
    const gaze = this.gaze.tick(dt, this.state, this.reducedMotion);
    const jitter = this.params.gazeJitter;
    const jitterX = !this.reducedMotion && jitter ? (this.streams.gaze() - 0.5) * jitter * 1.4 : 0;
    const jitterY = !this.reducedMotion && jitter ? (this.streams.gaze() - 0.5) * jitter * 0.8 : 0;

    this.speech.tick(dt);
    const speech = this.speech.out;
    const dyn = this.frame.dyn;
    dyn.t = this.time;
    dyn.coherence = this.coherence;
    dyn.gazeX = gaze.x + jitterX;
    dyn.gazeY = gaze.y + jitterY;
    dyn.blink = gaze.blink;
    dyn.mouthOpen = speech.open;
    dyn.mouthWide = speech.wide;
    dyn.tension = speech.tension;
    dyn.energy = speech.energy;
    dyn.swayX = this.reducedMotion ? 0 : Math.sin(this.time * 0.31) * 0.015 * this.params.swayAmp;
    dyn.swayY = this.reducedMotion ? 0 :
      Math.sin(this.time * 0.47) * 0.012 * this.params.swayAmp +
      Math.sin(this.time * 1.7) * 0.004 * this.params.breathAmp;
    this.frame.visualEvent = this.events.tick(dt, {
      rows: this.rows,
      reducedMotion: this.reducedMotion,
    });
    const phase = `${this.frame.visualEvent.type}:${this.frame.visualEvent.phase}`;
    if (phase !== this._visualPhase) {
      this._visualPhase = phase;
      this.dispatchEvent(new CustomEvent('visualevent', {
        detail: {
          type: this.frame.visualEvent.type,
          phase: this.frame.visualEvent.phase,
          active: this.frame.visualEvent.active,
        },
      }));
    }
    this.frame.mode = this.state;
    return this.frame;
  }

  getSnapshot() {
    return {
      state: this.state,
      emotion: this.emotion,
      coherence: this.coherence,
      reducedMotion: this.reducedMotion,
      visualIntensity: this.events.intensity,
    };
  }

  destroy() {
    if (!this.machine.destroy()) return false;
    this.speech.setSpeaking(false);
    this.speech.detach();
    this.events.destroy();
    return true;
  }
}
