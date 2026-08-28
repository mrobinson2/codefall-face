const TRANSIENT = Object.freeze([
  'brightness', 'region', 'distance', 'material', 'depth', 'substrate',
]);

export class SceneBuffers {
  constructor({ glyphRandom = Math.random, churnRandom = Math.random } = {}) {
    this.glyphRandom = glyphRandom;
    this.churnRandom = churnRandom;
    this.cols = 0;
    this.rows = 0;
    this.arrays = {
      brightness: null,
      region: null,
      distance: null,
      material: null,
      depth: null,
      substrate: null,
      glyph: null,
      churnPhase: null,
    };
    for (const key of Object.keys(this.arrays)) this[key] = null;
  }

  get length() { return this.cols * this.rows; }

  resize(cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
      throw new RangeError('Scene buffer dimensions must be positive integers');
    }
    if (cols === this.cols && rows === this.rows) return false;
    this.cols = cols;
    this.rows = rows;
    const length = cols * rows;
    this._assign('brightness', new Float32Array(length));
    this._assign('region', new Uint8Array(length));
    this._assign('distance', new Float32Array(length));
    this._assign('material', new Uint8Array(length));
    this._assign('depth', new Float32Array(length));
    this._assign('substrate', new Float32Array(length));
    this._assign('glyph', new Uint16Array(length));
    this._assign('churnPhase', new Float32Array(length));
    for (let i = 0; i < length; i++) {
      this.glyph[i] = Math.floor(this.glyphRandom() * 65536) & 0xffff;
      this.churnPhase[i] = this.churnRandom();
    }
    return true;
  }

  clearFrame() {
    for (const key of TRANSIENT) this[key].fill(0);
  }

  _assign(key, value) {
    this[key] = value;
    this.arrays[key] = value;
  }
}
