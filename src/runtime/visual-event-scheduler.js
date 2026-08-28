const TYPES = Object.freeze([
  'seam-crawl', 'ocular-desync', 'mask-slip', 'aperture-breach',
]);

const EMPTY_BANDS = Object.freeze([]);

function range(random, min, max) {
  return min + random() * (max - min);
}

function chooseType(roll) {
  if (roll < 0.25) return TYPES[0];
  if (roll < 0.5) return TYPES[1];
  if (roll < 0.75) return TYPES[2];
  return TYPES[3];
}

function cadence(random, type) {
  if (type === 'seam-crawl') return range(random, 3, 8);
  if (type === 'ocular-desync') return range(random, 8, 20);
  if (type === 'mask-slip') return range(random, 12, 30);
  return range(random, 18, 45);
}

function duration(random, type) {
  if (type === 'seam-crawl') return range(random, 0.4, 1.2);
  if (type === 'ocular-desync') return range(random, 0.08, 0.22);
  if (type === 'mask-slip') return range(random, 0.18, 0.5);
  return range(random, 0.25, 0.65);
}

export class VisualEventScheduler {
  constructor({ random = Math.random, intensity = 0.65 } = {}) {
    this.random = random;
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.time = 0;
    this.active = null;
    this.nextType = chooseType(this.random());
    this.nextAt = this._cadence(this.nextType);
    this._bands = [
      { start: 0, height: 0, offset: 0 },
      { start: 0, height: 0, offset: 0 },
      { start: 0, height: 0, offset: 0 },
    ];
    this._aperture = { side: 1, y: 0, radius: 0.08 };
    this.output = {
      active: false,
      type: 'none',
      phase: 'idle',
      envelope: 0,
      bands: EMPTY_BANDS,
      aperture: null,
      haloDrop: 0,
      eyeSide: 0,
    };
  }

  setIntensity(value) {
    if (!Number.isFinite(value)) return false;
    this.intensity = Math.max(0, Math.min(1, value));
    if (!this.active) this.nextAt = this.time + this._cadence(this.nextType);
    return true;
  }

  tick(dt, { rows = 1, reducedMotion = false } = {}) {
    this.time += Math.max(0, dt);
    if (this.active && this.time >= this.active.start + this.active.duration) {
      this.active = null;
      this._scheduleNext();
    }
    if (!this.active && this.time >= this.nextAt) this._begin(Math.max(1, rows | 0));
    if (!this.active) return this._idle();

    if (reducedMotion && this.active.type === 'seam-crawl' &&
        this.time >= this.active.start + 0.3) {
      this.active = null;
      this._scheduleNext();
      return this._idle();
    }

    const progress = Math.max(0, Math.min(1,
      (this.time - this.active.start) / this.active.duration));
    const envelope = Math.sin(progress * Math.PI);
    const type = this.active.type;
    const suppressed = reducedMotion && (type === 'ocular-desync' || type === 'mask-slip');
    if (suppressed) {
      this.active = null;
      this._scheduleNext();
      return this._idle();
    }

    const out = this.output;
    out.active = true;
    out.type = type;
    out.phase = progress < 0.2 ? 'opening' : progress > 0.8 ? 'closing' : 'active';
    out.envelope = reducedMotion ? 1 : envelope;
    out.bands = reducedMotion || type === 'seam-crawl' || type === 'ocular-desync'
      ? EMPTY_BANDS : this._bands;
    out.aperture = type === 'aperture-breach' ? this._aperture : null;
    out.haloDrop = reducedMotion ? 0 : (type === 'aperture-breach' ? envelope * 0.55 : 0);
    out.eyeSide = type === 'ocular-desync' ? this._aperture.side : 0;
    return out;
  }

  destroy() {
    this.active = null;
    this.nextAt = Infinity;
    this._idle();
  }

  _begin(rows) {
    const type = this.nextType;
    const bandCount = type === 'mask-slip' || type === 'aperture-breach'
      ? 2 + Math.floor(this.random() * 2) : 0;
    for (let i = 0; i < this._bands.length; i++) {
      this._bands[i].start = 0;
      this._bands[i].height = 0;
      this._bands[i].offset = 0;
    }
    for (let i = 0; i < bandCount; i++) {
      const height = Math.max(1, Math.floor(2 + this.random() * Math.max(3, rows * 0.08)));
      const start = Math.max(0, Math.min(rows - height, Math.floor(this.random() * rows)));
      const rawOffset = Math.round(range(this.random, -5, 5) * (0.45 + this.intensity * 0.95));
      this._bands[i].start = start;
      this._bands[i].height = Math.min(height, rows - start);
      this._bands[i].offset = Math.max(-12, Math.min(12, rawOffset || 1));
    }
    this._aperture.side = this.random() < 0.5 ? -1 : 1;
    this._aperture.y = range(this.random, -0.2, 0.58);
    this._aperture.radius = range(this.random, 0.06, 0.13);
    this.active = {
      type,
      start: this.time,
      duration: duration(this.random, type),
      bandCount,
    };
  }

  _scheduleNext() {
    this.nextType = chooseType(this.random());
    this.nextAt = this.time + this._cadence(this.nextType);
  }

  _cadence(type) {
    return cadence(this.random, type) * (1.35 - this.intensity * 0.7);
  }

  _idle() {
    const out = this.output;
    out.active = false;
    out.type = 'none';
    out.phase = 'idle';
    out.envelope = 0;
    out.bands = EMPTY_BANDS;
    out.aperture = null;
    out.haloDrop = 0;
    out.eyeSide = 0;
    return out;
  }
}
