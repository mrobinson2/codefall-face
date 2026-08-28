const TIERS = Object.freeze(['low', 'medium', 'high']);

function event(detail) {
  return new CustomEvent('change', { detail });
}

export class QualityController extends EventTarget {
  constructor({ policy = 'auto', now = () => performance.now() } = {}) {
    super();
    if (policy !== 'auto' && !TIERS.includes(policy)) throw new TypeError(`invalid quality: ${policy}`);
    this.policy = policy;
    this.tier = policy === 'auto' ? 'high' : policy;
    this.now = now;
    this._frames = 0;
    this._milliseconds = 0;
    this._slowWindows = 0;
    this._fastWindows = 0;
    this._cooldownUntil = 0;
  }

  chooseInitial({ width, height, dpr = 1 }) {
    if (this.policy !== 'auto') return this.tier;
    const pixels = Math.max(1, width) * Math.max(1, height) * Math.max(1, dpr);
    const tier = width < 420 || height < 500 || pixels > 3200000
      ? 'low'
      : width < 1000 || height < 700 || pixels > 1400000 ? 'medium' : 'high';
    this._change(tier, 'viewport');
    return this.tier;
  }

  sample(frameMilliseconds, { hidden = false, resizing = false } = {}) {
    if (this.policy !== 'auto' || hidden || resizing ||
        !Number.isFinite(frameMilliseconds) || frameMilliseconds <= 0) return this.tier;
    if (this.now() < this._cooldownUntil) {
      this._resetWindows();
      return this.tier;
    }
    this._frames++;
    this._milliseconds += frameMilliseconds;
    if (this._frames < 120) return this.tier;
    const average = this._milliseconds / this._frames;
    this._frames = 0;
    this._milliseconds = 0;
    if (average > 22) {
      this._slowWindows++;
      this._fastWindows = 0;
      if (this._slowWindows >= 2) this._step(-1, 'slow-frame-window');
    } else if (average < 14.5) {
      this._fastWindows++;
      this._slowWindows = 0;
      if (this._fastWindows >= 4) this._step(1, 'fast-frame-window');
    } else {
      this._slowWindows = 0;
      this._fastWindows = 0;
    }
    return this.tier;
  }

  setPolicy(policy) {
    if (policy !== 'auto' && !TIERS.includes(policy)) return false;
    if (policy === this.policy && (policy === 'auto' || this.tier === policy)) return false;
    this.policy = policy;
    this._resetWindows();
    if (policy !== 'auto') this._change(policy, 'policy', true);
    else this.dispatchEvent(event({ policy: this.policy, tier: this.tier, reason: 'policy' }));
    return true;
  }

  getSnapshot() { return { policy: this.policy, tier: this.tier }; }

  _step(direction, reason) {
    const index = TIERS.indexOf(this.tier);
    const next = TIERS[Math.max(0, Math.min(TIERS.length - 1, index + direction))];
    this._change(next, reason);
    this._resetWindows();
  }

  _change(tier, reason, policyChanged = false) {
    if (tier === this.tier && !policyChanged) return false;
    this.tier = tier;
    this._cooldownUntil = this.now() + 8000;
    this.dispatchEvent(event({ policy: this.policy, tier, reason }));
    return true;
  }

  _resetWindows() {
    this._frames = 0;
    this._milliseconds = 0;
    this._slowWindows = 0;
    this._fastWindows = 0;
  }
}
