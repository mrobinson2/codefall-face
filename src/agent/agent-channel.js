import { parseAgentCommand } from './commands.js';

const BACKOFF = Object.freeze([1000, 2000, 4000, 8000, 15000]);
const STABLE_AFTER = 10000;

export class AgentChannel {
  constructor({ platform, dispatchCommand, getSnapshot, random = Math.random }) {
    this.platform = platform;
    this.dispatchCommand = dispatchCommand;
    this.readSnapshot = getSnapshot;
    this.random = random;
    this.status = 'detached';
    this._socket = null;
    this._url = null;
    this._reconnect = true;
    this._attempt = 0;
    this._reconnectTimer = null;
    this._stableTimer = null;
    this._attached = false;
    this._destroyed = false;
    this._pendingSnapshot = false;
  }

  attach(url, { reconnect = true } = {}) {
    if (this._destroyed) return false;
    if (typeof url !== 'string' || !url) throw new TypeError('AgentChannel requires a WebSocket URL');
    this.detach();
    this._url = this._normalizeUrl(url);
    this._reconnect = !!reconnect;
    this._attempt = 0;
    this._attached = true;
    this._connect();
    return true;
  }

  publish(type, detail = {}) {
    if (this._destroyed) return false;
    const socket = this._socket;
    if (socket && socket.readyState === this.platform.WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, ...detail }));
      return true;
    }
    if (this._attached) this._pendingSnapshot = true;
    return false;
  }

  detach() {
    if (this._destroyed) return false;
    this._attached = false;
    this._clearTimers();
    const socket = this._socket;
    this._socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch { /* already closed */ }
    }
    this.status = 'detached';
    return !!socket;
  }

  destroy() {
    if (this._destroyed) return false;
    this.detach();
    this._destroyed = true;
    this.status = 'destroyed';
    this._pendingSnapshot = false;
    return true;
  }

  getSnapshot() {
    return {
      status: this.status,
      reconnect: this._attached && this._reconnect,
      attempt: this._attempt,
      url: this._url,
    };
  }

  _normalizeUrl(url) {
    if (!url.startsWith('/')) return url;
    const proto = this.platform.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${this.platform.location.host}${url}`;
  }

  _connect() {
    if (!this._attached || this._destroyed) return;
    this.status = 'connecting';
    const socket = this.platform.createWebSocket(this._url);
    this._socket = socket;
    socket.onopen = () => {
      if (socket !== this._socket || !this._attached) return;
      this.status = 'connected';
      socket.send(JSON.stringify({
        type: 'hello', client: 'codefall-face', snapshot: this.readSnapshot(),
      }));
      if (this._pendingSnapshot) {
        this._pendingSnapshot = false;
        socket.send(JSON.stringify({ type: 'snapshot', snapshot: this.readSnapshot() }));
      }
      this._stableTimer = this.platform.setTimeout(() => {
        this._stableTimer = null;
        if (socket === this._socket && socket.readyState === this.platform.WebSocket.OPEN) {
          this._attempt = 0;
        }
      }, STABLE_AFTER);
    };
    socket.onmessage = (message) => this._receive(socket, message.data);
    socket.onerror = () => { /* close owns retry timing */ };
    socket.onclose = () => this._closed(socket);
  }

  _receive(socket, raw) {
    if (socket !== this._socket || this._destroyed) return;
    const result = parseAgentCommand(raw);
    if (!result.ok) {
      if (socket.readyState === this.platform.WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'diagnostic', code: result.code, message: result.message }));
      }
      return;
    }
    try {
      const returned = this.dispatchCommand(result.command);
      if (returned && typeof returned.catch === 'function') {
        returned.catch((error) => this.publish('error', { message: error.message }));
      }
    } catch (error) {
      this.publish('error', { message: error.message });
    }
  }

  _closed(socket) {
    if (socket !== this._socket) return;
    this._socket = null;
    if (this._stableTimer != null) this.platform.clearTimeout(this._stableTimer);
    this._stableTimer = null;
    if (!this._attached || !this._reconnect || this._destroyed) {
      this.status = 'detached';
      return;
    }
    this.status = 'reconnecting';
    const base = BACKOFF[Math.min(this._attempt, BACKOFF.length - 1)];
    this._attempt++;
    const delay = Math.min(15000, base + base * 0.2 * Math.max(0, Math.min(1, this.random())));
    this._reconnectTimer = this.platform.setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _clearTimers() {
    if (this._reconnectTimer != null) this.platform.clearTimeout(this._reconnectTimer);
    if (this._stableTimer != null) this.platform.clearTimeout(this._stableTimer);
    this._reconnectTimer = null;
    this._stableTimer = null;
  }
}
