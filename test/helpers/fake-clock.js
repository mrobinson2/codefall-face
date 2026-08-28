export class FakeClock {
  constructor() {
    this.now = 0;
    this._nextId = 1;
    this._timers = new Map();
    this._animationFrames = new Map();
  }

  requestAnimationFrame(callback) {
    const id = this._nextId++;
    this._animationFrames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id) {
    this._animationFrames.delete(id);
  }

  setTimeout(callback, delay = 0) {
    const id = this._nextId++;
    this._timers.set(id, {
      id,
      due: this.now + Math.max(0, Number(delay) || 0),
      callback,
    });
    return id;
  }

  clearTimeout(id) {
    this._timers.delete(id);
  }

  advance(milliseconds) {
    const target = this.now + Math.max(0, Number(milliseconds) || 0);
    while (true) {
      let next = null;
      for (const timer of this._timers.values()) {
        if (timer.due > target) continue;
        if (!next || timer.due < next.due ||
            (timer.due === next.due && timer.id < next.id)) next = timer;
      }
      if (!next) break;
      this.now = next.due;
      this._timers.delete(next.id);
      next.callback();
    }
    this.now = target;
    const frames = [...this._animationFrames.values()];
    this._animationFrames.clear();
    for (const callback of frames) callback(this.now);
  }

  pending() {
    return {
      timers: this._timers.size,
      animationFrames: this._animationFrames.size,
    };
  }

  nextTimer() {
    let next = null;
    for (const timer of this._timers.values()) {
      if (!next || timer.due < next.due ||
          (timer.due === next.due && timer.id < next.id)) next = timer;
    }
    return next ? { id: next.id, time: next.due } : null;
  }
}
