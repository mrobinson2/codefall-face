import { FakeClock } from './fake-clock.js';

class FakeEventTarget {
  constructor() {
    this._listeners = new Map();
  }

  addEventListener(type, callback) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this._listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const callback of this._listeners.get(event.type) || []) callback.call(this, event);
    return true;
  }
}

function createRecordingContext(operations) {
  const stack = [];
  const context = {
    operations,
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: 'transparent',
    lineWidth: 1,
    lineCap: 'butt',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    font: '10px sans-serif',
    imageSmoothingEnabled: true,
    setTransform(...args) { operations.push(['setTransform', ...args]); },
    resetTransform() { operations.push(['resetTransform']); },
    clearRect(...args) { operations.push(['clearRect', ...args]); },
    fillRect(...args) { operations.push(['fillRect', ...args]); },
    drawImage(...args) { operations.push(['drawImage', ...args]); },
    beginPath() { operations.push(['beginPath']); },
    closePath() { operations.push(['closePath']); },
    arc(...args) { operations.push(['arc', ...args]); },
    ellipse(...args) { operations.push(['ellipse', ...args]); },
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    stroke() { operations.push(['stroke']); },
    fill() { operations.push(['fill']); },
    fillText(...args) { operations.push(['fillText', ...args]); },
    save() {
      operations.push(['save']);
      stack.push({
        fillStyle: this.fillStyle,
        strokeStyle: this.strokeStyle,
        globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation,
        shadowBlur: this.shadowBlur,
        shadowColor: this.shadowColor,
        lineWidth: this.lineWidth,
      });
    },
    restore() {
      operations.push(['restore']);
      Object.assign(this, stack.pop() || {});
    },
    translate(...args) { operations.push(['translate', ...args]); },
    rotate(...args) { operations.push(['rotate', ...args]); },
    scale(...args) { operations.push(['scale', ...args]); },
    createRadialGradient(...args) {
      operations.push(['createRadialGradient', ...args]);
      return { addColorStop(...stop) { operations.push(['addColorStop', ...stop]); } };
    },
  };
  return context;
}

function createCanvas(width, height) {
  const operations = [];
  const context = createRecordingContext(operations);
  return {
    className: '',
    width,
    height,
    style: {},
    dataset: {},
    operations,
    removed: false,
    getContext: () => context,
    getBoundingClientRect: () => ({ x: 0, y: 0, width, height, top: 0, left: 0, right: width, bottom: height }),
    remove() { this.removed = true; },
  };
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.CONNECTING = FakeWebSocket.CONNECTING;
    this.OPEN = FakeWebSocket.OPEN;
    this.CLOSING = FakeWebSocket.CLOSING;
    this.CLOSED = FakeWebSocket.CLOSED;
    this.readyState = this.CONNECTING;
    this.sent = [];
  }

  open() {
    this.readyState = this.OPEN;
    this.onopen?.({ type: 'open', target: this });
  }

  message(data) {
    this.onmessage?.({ type: 'message', data, target: this });
  }

  error(error = new Error('socket error')) {
    this.onerror?.({ type: 'error', error, target: this });
  }

  send(value) {
    if (this.readyState !== this.OPEN) throw new Error('WebSocket is not open');
    this.sent.push(value);
  }

  close() {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.onclose?.({ type: 'close', target: this });
  }
}

export function createFakePlatform(options = {}) {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const clock = options.clock || new FakeClock();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  const sockets = [];

  Object.assign(windowTarget, {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: options.dpr ?? 1,
  });
  Object.assign(documentTarget, {
    hidden: false,
    body: { dataset: {} },
    createElement(tag) {
      if (tag === 'canvas') return createCanvas(width, height);
      return new FakeEventTarget();
    },
  });

  return {
    clock,
    window: windowTarget,
    document: documentTarget,
    WebSocket: FakeWebSocket,
    sockets,
    createCanvas: () => createCanvas(width, height),
    createWebSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: () => clock.now,
    random: () => 0.5,
    requestAnimationFrame: (callback) => clock.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => clock.cancelAnimationFrame(id),
    setTimeout: (callback, delay) => clock.setTimeout(callback, delay),
    clearTimeout: (id) => clock.clearTimeout(id),
    location: { protocol: 'http:', host: 'example.test' },
    matchMedia: () => ({ matches: !!options.reducedMotion, addEventListener() {}, removeEventListener() {} }),
    setHidden(hidden) {
      documentTarget.hidden = !!hidden;
      documentTarget.dispatchEvent({ type: 'visibilitychange' });
    },
    dispatchResize() { windowTarget.dispatchEvent({ type: 'resize' }); },
    listenerCount(target, type) { return target._listeners.get(type)?.size || 0; },
  };
}
