/**
 * Codefall Face — minimal backend.
 *
 * Four jobs, nothing else:
 *   1. Serve the static app (so `npm start` is the whole setup).
 *   2. /relay  — WebSocket relay to Azure Voice Live. Browsers cannot
 *      attach auth headers to WebSockets, so this process holds the
 *      key and pipes frames verbatim in both directions.
 *   3. /api/lacy/* — authenticated proxy for the Lacy.ai fallback.
 *   4. Agent hub — /agent-hub (WS, faces connect) + /api/face/* (HTTP,
 *      agents command). Bridges any orchestrator (a Hermes agent, a
 *      bot, a cron job) to every connected face: POST a command, it
 *      broadcasts to the browsers; face events (user transcripts,
 *      state changes) stream back via webhook and a pollable buffer.
 *      Set FACE_HUB_TOKEN before exposing beyond localhost.
 *
 * Without AZURE_VOICE_LIVE_* env vars the app still works fully —
 * clients just auto-fall back to the local Web Speech provider.
 *
 * deps: ws (the only dependency in the whole project)
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import process from 'node:process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8787);

const AZURE_ENDPOINT = process.env.AZURE_VOICE_LIVE_ENDPOINT; // e.g. https://myres.cognitiveservices.azure.com
const AZURE_KEY = process.env.AZURE_VOICE_LIVE_KEY;
const AZURE_MODEL = process.env.AZURE_VOICE_LIVE_MODEL || 'gpt-4o';
const AZURE_API_VERSION = process.env.AZURE_VOICE_LIVE_API_VERSION || '2025-05-01-preview';

const LACY_API_KEY = process.env.LACY_API_KEY;
const LACY_BASE = process.env.LACY_BASE || 'https://app.lacy.ai/api';
const LACY_REPLY_PATH = process.env.LACY_REPLY_PATH || '/user/ai/reply';

const FACE_HUB_TOKEN = process.env.FACE_HUB_TOKEN; // optional shared secret
const FACE_EVENTS_WEBHOOK = process.env.FACE_EVENTS_WEBHOOK; // optional POST target

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
  }
}

async function handleLacy(req, res, path) {
  if (path === '/api/lacy/health') {
    res.writeHead(LACY_API_KEY ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: !!LACY_API_KEY }));
    return;
  }
  if (!LACY_API_KEY) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'LACY_API_KEY not configured' }));
    return;
  }
  if (path === '/api/lacy/reply' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { message } = JSON.parse(body || '{}');
      const upstream = await fetch(`${LACY_BASE}${LACY_REPLY_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LACY_API_KEY}`,
        },
        body: JSON.stringify({ message }),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(text);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: String(err) }));
    }
    return;
  }
  res.writeHead(404).end();
}

// ---- Agent hub ------------------------------------------------------------
// Faces connect via WS at /agent-hub; agents command via HTTP /api/face/*.

const faces = new Set(); // connected face sockets
const hubEvents = []; // ring buffer of face→agent events
let hubSeq = 0;
const HUB_EVENTS_MAX = 200;
// Commands an agent may broadcast — mirrors CodefallFace.attachAgentSocket.
const HUB_COMMANDS = new Set(['speak', 'ask', 'emotion', 'listen', 'interrupt', 'mute', 'theme']);

function hubAuthorized(req) {
  if (!FACE_HUB_TOKEN) return true;
  const url = new URL(req.url, 'http://x');
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return bearer === FACE_HUB_TOKEN || url.searchParams.get('token') === FACE_HUB_TOKEN;
}

function hubBroadcast(cmd) {
  let delivered = 0;
  const msg = JSON.stringify(cmd);
  for (const ws of faces) {
    if (ws.readyState === WebSocket.OPEN) { ws.send(msg); delivered++; }
  }
  return delivered;
}

function hubRecordEvent(event) {
  const entry = { seq: ++hubSeq, ts: new Date().toISOString(), ...event };
  hubEvents.push(entry);
  if (hubEvents.length > HUB_EVENTS_MAX) hubEvents.shift();
  if (FACE_EVENTS_WEBHOOK) {
    fetch(FACE_EVENTS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch((err) => console.error('[hub] webhook error:', err.message));
  }
}

async function handleFaceApi(req, res, path) {
  if (!hubAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'missing or bad FACE_HUB_TOKEN' }));
    return;
  }
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (path === '/api/face/status' && req.method === 'GET') {
    return json(200, { faces: faces.size, lastSeq: hubSeq });
  }
  if (path === '/api/face/events' && req.method === 'GET') {
    const since = Number(new URL(req.url, 'http://x').searchParams.get('since') || 0);
    return json(200, { events: hubEvents.filter((e) => e.seq > since), lastSeq: hubSeq });
  }
  if ((path === '/api/face/say' || path === '/api/face/command') && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let cmd;
    try { cmd = JSON.parse(body || '{}'); } catch { return json(400, { error: 'bad JSON' }); }
    if (path === '/api/face/say') {
      if (!cmd.text) return json(400, { error: 'text required' });
      cmd = { type: 'speak', text: cmd.text, emotion: cmd.emotion };
    }
    if (!HUB_COMMANDS.has(cmd.type)) {
      return json(400, { error: `unknown command type; allowed: ${[...HUB_COMMANDS].join(', ')}` });
    }
    return json(200, { delivered: hubBroadcast(cmd) });
  }
  json(404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path.startsWith('/api/lacy/')) return handleLacy(req, res, path);
  if (path.startsWith('/api/face/')) return handleFaceApi(req, res, path);
  return serveStatic(req, res);
});

// ---- Voice Live relay ---------------------------------------------------
// Reject at the HTTP upgrade when unconfigured, so browser clients get a
// clean connection error and auto-fall back to the local provider.
const wss = new WebSocketServer({ noServer: true });

const hubWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/agent-hub') {
    if (!hubAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    hubWss.handleUpgrade(req, socket, head, (ws) => hubWss.emit('connection', ws, req));
    return;
  }
  if (path !== '/relay') { socket.destroy(); return; }
  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

hubWss.on('connection', (ws) => {
  faces.add(ws);
  hubRecordEvent({ type: 'face_connected', faces: faces.size });
  ws.on('message', (data) => {
    let event;
    try { event = JSON.parse(data.toString()); } catch { return; }
    hubRecordEvent(event);
  });
  const drop = () => {
    if (faces.delete(ws)) hubRecordEvent({ type: 'face_disconnected', faces: faces.size });
  };
  ws.on('close', drop);
  ws.on('error', drop);
});

wss.on('connection', (client) => {
  const wsUrl =
    AZURE_ENDPOINT.replace(/^http/, 'ws').replace(/\/$/, '') +
    `/voice-live/realtime?api-version=${AZURE_API_VERSION}` +
    `&model=${encodeURIComponent(AZURE_MODEL)}`;

  const upstream = new WebSocket(wsUrl, { headers: { 'api-key': AZURE_KEY } });
  const queue = [];

  upstream.on('open', () => {
    for (const m of queue) upstream.send(m);
    queue.length = 0;
  });
  client.on('message', (data) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
    else if (upstream.readyState === WebSocket.CONNECTING) queue.push(data);
  });
  upstream.on('message', (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });
  const closeBoth = () => { try { client.close(); } catch {} try { upstream.close(); } catch {} };
  upstream.on('close', closeBoth);
  upstream.on('error', (err) => {
    console.error('[relay] upstream error:', err.message);
    closeBoth();
  });
  client.on('close', closeBoth);
  client.on('error', closeBoth);
});

server.listen(PORT, () => {
  console.log(`\n  CODEFALL // FACE`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Voice Live relay: ${AZURE_ENDPOINT && AZURE_KEY ? 'ARMED' : 'not configured (local Web Speech fallback active)'}`);
  console.log(`  Lacy proxy:       ${LACY_API_KEY ? 'ARMED' : 'not configured'}`);
  console.log(`  Agent hub:        ws /agent-hub + POST /api/face/say ` +
    `(auth: ${FACE_HUB_TOKEN ? 'token' : 'OPEN — set FACE_HUB_TOKEN before exposing'}; ` +
    `webhook: ${FACE_EVENTS_WEBHOOK || 'off'})\n`);
});
