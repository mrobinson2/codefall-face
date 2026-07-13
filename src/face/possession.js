const IDLE = Object.freeze({
  active: false,
  envelope: 0,
  bands: [],
  aperture: null,
  haloDrop: 0,
});

export function clampBand(start, height, rows) {
  const rawStart = Math.floor(start);
  const rawEnd = rawStart + Math.floor(height);
  const safeStart = Math.max(0, Math.min(rows, rawStart));
  const safeEnd = Math.max(safeStart, Math.min(rows, rawEnd));
  return {
    start: safeStart,
    height: safeEnd - safeStart,
  };
}

function range(random, min, max) {
  return min + random() * (max - min);
}

export class PossessionController {
  constructor(random = Math.random) {
    this.random = random;
    this.active = null;
    this.nextAt = range(random, 7, 18);
  }

  reset(now = 0) {
    this.active = null;
    this.nextAt = now + range(this.random, 7, 18);
  }

  start(now, rows, intensity) {
    const duration = range(this.random, 0.18, 0.65);
    const count = 2 + Math.floor(this.random() * 2);
    const bands = [];
    for (let i = 0; i < count; i++) {
      const raw = clampBand(
        this.random() * rows,
        2 + this.random() * Math.max(3, rows * 0.08),
        rows,
      );
      bands.push({
        ...raw,
        offset: Math.round(range(this.random, -5, 5) * intensity) || 1,
      });
    }
    this.active = {
      start: now,
      duration,
      bands,
      aperture: {
        side: this.random() < 0.5 ? -1 : 1,
        y: range(this.random, -0.2, 0.58),
        radius: range(this.random, 0.06, 0.13),
      },
    };
  }

  update(now, options = {}) {
    const rows = Math.max(1, options.rows || 1);
    if (options.reducedMotion) {
      this.reset(now);
      return IDLE;
    }
    const intensity = Math.max(0.45, Math.min(1.4, options.intensity || 1));
    if (!this.active && now >= this.nextAt) this.start(now, rows, intensity);
    if (!this.active) return IDLE;

    if (now >= this.active.start + this.active.duration) {
      this.active = null;
      this.nextAt = now + range(this.random, 7, 18);
      return IDLE;
    }
    const progress = (now - this.active.start) / this.active.duration;
    const pulse = Math.abs(Math.sin(progress * Math.PI * 3));
    return {
      active: true,
      envelope: pulse,
      bands: this.active.bands,
      aperture: this.active.aperture,
      haloDrop: pulse * 0.55,
    };
  }
}
