/**
 * Codefall Face — minimal backend.
 *
 * Three jobs, nothing else:
 *   1. Serve the static app (so `npm start` is the whole setup).
 *   2. /relay  — WebSocket relay to Azure Voice Live. Browsers cannot
 *      attach auth headers to WebSockets, so this process holds the
 *      key and pipes frames verbatim in both directions.
 *   3. /api/lacy/* — authenticated proxy for the Lacy.ai fallback.
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

const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path.startsWith('/api/lacy/')) return handleLacy(req, res, path);
  return serveStatic(req, res);
});

// ---- Voice Live relay ---------------------------------------------------
// Reject at the HTTP upgrade when unconfigured, so browser clients get a
// clean connection error and auto-fall back to the local provider.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path !== '/relay') { socket.destroy(); return; }
  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
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
  console.log(`  Lacy proxy:       ${LACY_API_KEY ? 'ARMED' : 'not configured'}\n`);
});
