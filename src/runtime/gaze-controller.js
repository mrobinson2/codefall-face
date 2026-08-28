export class GazeController {
  constructor({ gazeRandom = Math.random, blinkRandom = Math.random } = {}) {
    this.gazeRandom = gazeRandom;
    this.blinkRandom = blinkRandom;
    this.output = { x: 0, y: 0, blink: 1 };
    this.targetX = 0;
    this.targetY = 0;
    this.targetTimer = 0;
    this.blinkTimer = 1.8 + this.blinkRandom() * 4.2;
    this.blinkElapsed = null;
  }

  tick(dt, mode, reducedMotion) {
    const out = this.output;
    if (reducedMotion) {
      out.x = 0;
      out.y = 0;
      out.blink = 1;
      return out;
    }

    this.targetTimer -= dt;
    if (this.targetTimer <= 0) {
      if (mode === 'thinking') {
        this.targetX = (this.gazeRandom() - 0.5) * 2.4;
        this.targetY = (this.gazeRandom() - 0.5) * 1.6;
        this.targetTimer = 0.12 + this.gazeRandom() * 0.2;
      } else if (mode === 'listening') {
        this.targetX = 0;
        this.targetY = -0.3;
        this.targetTimer = 0.5;
      } else {
        this.targetX = (this.gazeRandom() - 0.5) * 1.2;
        this.targetY = (this.gazeRandom() - 0.5) * 0.8;
        this.targetTimer = 0.8 + this.gazeRandom() * 2.5;
      }
    }
    const amount = Math.min(1, 14 * dt);
    out.x += (this.targetX - out.x) * amount;
    out.y += (this.targetY - out.y) * amount;

    if (this.blinkElapsed === null) {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinkElapsed = 0;
        this.blinkTimer = 1.8 + this.blinkRandom() * 4.2;
      }
    } else {
      this.blinkElapsed += dt;
      const progress = this.blinkElapsed / 0.22;
      if (progress >= 1) {
        this.blinkElapsed = null;
        out.blink = 1;
      } else {
        out.blink = Math.abs(Math.cos(progress * Math.PI));
      }
    }
    return out;
  }
}
