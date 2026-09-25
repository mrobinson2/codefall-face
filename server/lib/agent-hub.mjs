/**
 * Agent hub — faces connect via WS (/agent-hub), agents command via HTTP
 * (/api/face/*). Commands are validated against the same schema the browser
 * enforces (src/agent/commands.js), so the server never broadcasts a command
 * a face would reject. Face events (transcripts, state changes) flow back
 * through a ring buffer, an optional webhook, and a long-poll listen route.
 */

import { parseAgentCommand } from '../../src/agent/commands.js';
import { readJson, sendJson, HttpInputError } from './http-utils.mjs';

const WS_OPEN = 1;
const LISTEN_MIN_MS = 1000;
const LISTEN_MAX_MS = 120000;
const LISTEN_DEFAULT_MS = 30000;

export function createAgentHub({
  token = null,
  webhook = null,
  maxEvents = 200,
  fetchImpl = globalThis.fetch,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
  log = console.error,
} = {}) {
  const faces = new Set();
  const events = [];
  const waiters = new Set();
  let seq = 0;

  function authorized(req) {
    if (!token) return true;
    const url = new URL(req.url, 'http://x');
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return bearer === token || url.searchParams.get('token') === token;
  }

  function broadcast(cmd) {
    let delivered = 0;
    const msg = JSON.stringify(cmd);
    for (const ws of faces) {
      if (ws.readyState === WS_OPEN) {
        ws.send(msg);
        delivered++;
      }
    }
    return delivered;
  }

  function recordEvent(event) {
    const entry = { seq: ++seq, ts: new Date().toISOString(), ...event };
    events.push(entry);
    if (events.length > maxEvents) events.shift();
    if (webhook) {
      Promise.resolve()
        .then(() => fetchImpl(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        }))
        .catch((err) => log('[hub] webhook error:', err.message));
    }
    if (entry.type === 'transcript' && entry.role === 'user' && entry.final === true) {
      for (const waiter of [...waiters]) waiter.resolve(entry);
    }
    return entry;
  }

  // Broadcast semantics: every in-flight listener receives the same
  // transcript, mirroring how commands broadcast to every face. Callers
  // needing correlation can compare the returned event's seq.
  function waitForTranscript(req, timeoutMs) {
    return new Promise((resolve) => {
      const waiter = {};
      const settle = (event) => {
        waiters.delete(waiter);
        timers.clearTimeout(timer);
        req.off?.('close', waiter.cancel);
        resolve(event);
      };
      const timer = timers.setTimeout(() => settle(null), timeoutMs);
      waiter.resolve = settle;
      waiter.cancel = () => {
        waiters.delete(waiter);
        timers.clearTimeout(timer);
        resolve(undefined); // request gone; caller must not write
      };
      waiters.add(waiter);
      req.on('close', waiter.cancel);
    });
  }

  async function handleHttp(req, res, path) {
    if (!authorized(req)) {
      return sendJson(res, 401, { error: 'missing or bad FACE_HUB_TOKEN' });
    }

    if (path === '/api/face/status' && req.method === 'GET') {
      return sendJson(res, 200, { faces: faces.size, lastSeq: seq });
    }

    if (path === '/api/face/events' && req.method === 'GET') {
      const since = Number(new URL(req.url, 'http://x').searchParams.get('since') || 0);
      return sendJson(res, 200, { events: events.filter((e) => e.seq > since), lastSeq: seq });
    }

    if (path === '/api/face/listen' && req.method === 'GET') {
      const raw = Number(new URL(req.url, 'http://x').searchParams.get('timeout') || LISTEN_DEFAULT_MS);
      const timeoutMs = Math.min(LISTEN_MAX_MS, Math.max(LISTEN_MIN_MS, Number.isFinite(raw) ? raw : LISTEN_DEFAULT_MS));
      const event = await waitForTranscript(req, timeoutMs);
      if (event === undefined) return undefined; // client disconnected mid-poll
      return sendJson(res, 200, { event, lastSeq: seq });
    }

    if ((path === '/api/face/say' || path === '/api/face/command') && req.method === 'POST') {
      let cmd;
      try {
        cmd = await readJson(req, { maxBytes: 65536 });
      } catch (error) {
        if (error instanceof HttpInputError) return sendJson(res, error.status, { error: error.message });
        return sendJson(res, 400, { error: 'bad JSON' });
      }
      if (path === '/api/face/say') {
        if (!cmd.text) return sendJson(res, 400, { error: 'text required' });
        cmd = { type: 'speak', text: cmd.text, ...(cmd.emotion ? { emotion: cmd.emotion } : {}) };
      }
      const result = parseAgentCommand(JSON.stringify(cmd));
      if (!result.ok) {
        return sendJson(res, 400, { error: result.message, code: result.code });
      }
      return sendJson(res, 200, { delivered: broadcast(result.command) });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  function handleSocket(ws) {
    faces.add(ws);
    recordEvent({ type: 'face_connected', faces: faces.size });
    ws.on('message', (data) => {
      let event;
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }
      recordEvent(event);
    });
    const drop = () => {
      if (faces.delete(ws)) recordEvent({ type: 'face_disconnected', faces: faces.size });
    };
    ws.on('close', drop);
    ws.on('error', drop);
  }

  return { authorized, handleHttp, handleSocket, broadcast, recordEvent };
}
