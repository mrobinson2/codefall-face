import { timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { sendJson } from './http-utils.mjs';

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_QUEUED_MESSAGES = 32;

export function voiceLiveUrl(endpoint, model = 'gpt-realtime', apiVersion = '2026-04-10') {
  if (!endpoint) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return null;
  }
  url.protocol = 'wss:';
  url.pathname = '/voice-live/realtime';
  url.searchParams.set('api-version', apiVersion);
  url.searchParams.set('model', model);
  return url;
}

function bearerMatches(header, token) {
  if (!token || typeof header !== 'string') return false;
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) return false;
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function rejectUpgrade(socket, status, description) {
  socket.end(`HTTP/1.1 ${status} ${description}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createVoiceRelay({
  endpoint,
  key,
  model,
  apiVersion,
  token,
  allowedOrigins = [],
  maxPayload = 256 * 1024,
  maxSessions = 8,
  sessionTimeoutMs = 15 * 60 * 1000,
  dial = (url, options) => new WebSocket(url, options),
  log = console.error,
} = {}) {
  const upstreamUrl = voiceLiveUrl(endpoint, model, apiVersion);
  const configured = !!(upstreamUrl && key);
  const origins = new Set(allowedOrigins);
  const clients = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  const bufferLimit = maxPayload * 2;

  function checkAccess(req) {
    const { host, origin, authorization } = req.headers;
    const local = LOOPBACK_ADDRESSES.has(req.socket.remoteAddress) && LOOPBACK_HOST.test(host || '');
    const scheme = req.socket.encrypted ? 'https' : 'http';
    const sameLoopbackOrigin = local && origin === `${scheme}://${host.toLowerCase()}`;
    if (origin && !sameLoopbackOrigin && !origins.has(origin)) return 403;
    if (!token && local && (!origin || sameLoopbackOrigin)) return 200;
    return bearerMatches(authorization, token) ? 200 : 401;
  }

  function handleHealth(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { available: false }, { Allow: 'GET' });
    return sendJson(res, 200, { available: configured && checkAccess(req) === 200 });
  }

  function handleUpgrade(req, socket, head) {
    const access = checkAccess(req);
    if (access === 403) return rejectUpgrade(socket, 403, 'Forbidden');
    if (access === 401) return rejectUpgrade(socket, 401, 'Unauthorized');
    if (!configured) return rejectUpgrade(socket, 503, 'Service Unavailable');
    if (clients.clients.size >= maxSessions) return rejectUpgrade(socket, 429, 'Too Many Requests');
    clients.handleUpgrade(req, socket, head, connect);
  }

  function connect(client) {
    let upstream;
    try {
      upstream = dial(upstreamUrl, {
        headers: { 'api-key': key },
        maxPayload,
        handshakeTimeout: 10000,
        perMessageDeflate: false,
      });
    } catch {
      client.close(1011, 'Voice service unavailable');
      return;
    }

    let closed = false;
    let queuedBytes = 0;
    const pending = [];
    const timeout = setTimeout(() => finish(1000, 'Voice session expired'), sessionTimeoutMs);
    timeout.unref();

    function finish(code, message) {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      pending.length = 0;
      if (client.readyState === WebSocket.OPEN) client.close(code, message);
      if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    }

    function send(target, data) {
      if (closed || target.readyState !== WebSocket.OPEN) return;
      if (target.bufferedAmount + data.length > bufferLimit) {
        finish(1013, 'Voice session overloaded');
        return;
      }
      // The browser expects JSON text frames, including audio encoded as Base64.
      target.send(data, { binary: false }, error => {
        if (error) finish(1011, 'Voice service unavailable');
      });
    }

    client.on('message', (data, binary) => {
      if (closed) return;
      if (binary) return finish(1003, 'Voice messages must be text');
      if (upstream.readyState === WebSocket.OPEN) return send(upstream, data);
      if (upstream.readyState !== WebSocket.CONNECTING) return;
      queuedBytes += data.length;
      if (queuedBytes > bufferLimit || pending.length >= MAX_QUEUED_MESSAGES) {
        return finish(1013, 'Voice session overloaded');
      }
      pending.push(data);
    });
    upstream.on('open', () => {
      for (const data of pending) send(upstream, data);
      pending.length = 0;
    });
    upstream.on('message', data => send(client, data));
    client.on('close', () => finish(1000, 'Voice session closed'));
    client.on('error', () => finish(1011, 'Voice connection closed'));
    upstream.on('close', () => finish(1011, 'Voice service disconnected'));
    upstream.on('error', () => {
      if (closed) return;
      log('[voice] Azure Voice Live connection failed');
      finish(1011, 'Voice service unavailable');
    });
  }

  return { configured, handleHealth, handleUpgrade };
}
