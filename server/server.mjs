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
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import process from 'node:process';
import { createStaticHandler } from './lib/static-handler.mjs';
import { createAgentHub } from './lib/agent-hub.mjs';

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

// Piper TTS (fully local neural voice — see server/setup-piper.sh).
// Defaults point at the setup script's output; override via env.
const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));
const PIPER_BIN = process.env.PIPER_BIN || join(SERVER_DIR, 'piper-venv/bin/piper');
const PIPER_VOICE = process.env.PIPER_VOICE || join(SERVER_DIR, 'voices/en_US-danny-low.onnx');
let piperRate = 16000;
let piperReady = false;
try {
  const cfg = JSON.parse(readFileSync(`${PIPER_VOICE}.json`, 'utf8'));
  piperRate = cfg.audio?.sample_rate || 16000;
  piperReady = existsSync(PIPER_BIN);
} catch { /* piper not set up — /api/tts reports unavailable */ }

const staticFiles = createStaticHandler({ root: ROOT });

async function serveStatic(req, res) {
  return staticFiles.handle(req, res);
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
// Logic lives in lib/agent-hub.mjs; commands are validated against the same
// schema the browser enforces (src/agent/commands.js).

const hub = createAgentHub({ token: FACE_HUB_TOKEN, webhook: FACE_EVENTS_WEBHOOK });

// ---- Piper TTS endpoint ---------------------------------------------------
async function handleTts(req, res, path) {
  if (path === '/api/tts/health') {
    res.writeHead(piperReady ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: piperReady, voice: piperReady ? PIPER_VOICE.split('/').pop() : null, sampleRate: piperRate }));
    return;
  }
  if (req.method !== 'POST') { res.writeHead(404).end(); return; }
  if (!piperReady) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'piper not set up — run server/setup-piper.sh' }));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let text;
  try { text = JSON.parse(body || '{}').text; } catch { /* fall through */ }
  if (!text || !text.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'text required' }));
    return;
  }
  const child = spawn(PIPER_BIN, ['--model', PIPER_VOICE, '--output-raw'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'X-Sample-Rate': String(piperRate),
    'Cache-Control': 'no-store',
  });
  child.stdout.pipe(res);
  let errOut = '';
  child.stderr.on('data', (d) => { errOut += d; });
  child.on('close', (code) => {
    if (code !== 0) console.error('[piper] exit', code, errOut.slice(-300));
    res.end();
  });
  child.on('error', (err) => {
    console.error('[piper] spawn failed:', err.message);
    res.end();
  });
  req.on('close', () => child.kill('SIGKILL')); // client interrupted
  child.stdin.write(text.replace(/\s+/g, ' ').trim() + '\n');
  child.stdin.end();
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path.startsWith('/api/lacy/')) return handleLacy(req, res, path);
  if (path.startsWith('/api/face/')) return hub.handleHttp(req, res, path);
  if (path.startsWith('/api/tts')) return handleTts(req, res, path);
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
    if (!hub.authorized(req)) {
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

hubWss.on('connection', (ws) => hub.handleSocket(ws));

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
  console.log(`  Piper TTS:        ${piperReady ? `ARMED (${PIPER_VOICE.split('/').pop()} @ ${piperRate} Hz)` : 'not set up (run server/setup-piper.sh)'}`);
  console.log(`  Agent hub:        ws /agent-hub + POST /api/face/say ` +
    `(auth: ${FACE_HUB_TOKEN ? 'token' : 'OPEN — set FACE_HUB_TOKEN before exposing'}; ` +
    `webhook: ${FACE_EVENTS_WEBHOOK || 'off'})\n`);
});
