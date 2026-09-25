#!/usr/bin/env node
/**
 * Codefall Face MCP server — gives any MCP client (Claude Code, Codex, …)
 * visual TTS/STT tools against a running face server. Zero dependencies:
 * plain JSON-RPC 2.0 over newline-delimited stdio.
 *
 * Register with Claude Code:
 *   claude mcp add codefall-face -- node integrations/mcp/codefall-face-mcp.mjs
 *
 * Register with Codex (~/.codex/config.toml):
 *   [mcp_servers.codefall_face]
 *   command = "node"
 *   args = ["/path/to/codefall-face/integrations/mcp/codefall-face-mcp.mjs"]
 *
 * Env: CODEFALL_FACE_URL (default http://localhost:8787), FACE_HUB_TOKEN.
 */

import process from 'node:process';
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'codefall-face', version: '1.0.0' };

const EMOTIONS = 'joy, sadness, anger, fear, surprise, confusion, focus, alert, neutral';

const TOOL_DEFINITIONS = [
  {
    name: 'face_speak',
    description: 'Speak text aloud through the Codefall Face with an optional emotion. '
      + 'Use for short status updates, results, and summaries the user should hear.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak aloud. Keep it short and conversational.' },
        emotion: { type: 'string', description: `Optional emotion, e.g. ${EMOTIONS}.` },
      },
      required: ['text'],
    },
  },
  {
    name: 'face_emotion',
    description: 'Set the face\'s emotional expression without speaking.',
    inputSchema: {
      type: 'object',
      properties: {
        emotion: { type: 'string', description: `Emotion to display, e.g. ${EMOTIONS}.` },
      },
      required: ['emotion'],
    },
  },
  {
    name: 'face_listen',
    description: 'Turn on the face\'s microphone and wait for the user to speak. '
      + 'Returns the transcribed speech. Use to capture a spoken answer or command.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutSeconds: { type: 'number', description: 'Seconds to wait for speech (default 30, max 120).' },
      },
    },
  },
  {
    name: 'face_ask',
    description: 'Speak a question aloud, then listen for and return the user\'s spoken reply. '
      + 'The full voice round trip in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Question to speak aloud.' },
        emotion: { type: 'string', description: `Optional emotion while asking, e.g. ${EMOTIONS}.` },
        timeoutSeconds: { type: 'number', description: 'Seconds to wait for the reply (default 30, max 120).' },
      },
      required: ['text'],
    },
  },
  {
    name: 'face_set',
    description: 'Adjust the face\'s presentation: theme, geometry, render quality, or visual intensity.',
    inputSchema: {
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['wintermute', 'codefall'] },
        geometry: { type: 'string', enum: ['chiseled', 'smooth'] },
        quality: { type: 'string', enum: ['auto', 'high', 'medium', 'low'] },
        visualIntensity: { type: 'number', description: 'Glitch/event intensity, 0 to 1.' },
      },
    },
  },
  {
    name: 'face_status',
    description: 'Check how many faces are connected to the hub and the latest event sequence.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function text(message, isError = false) {
  return { content: [{ type: 'text', text: message }], ...(isError ? { isError: true } : {}) };
}

function clampTimeoutMs(seconds) {
  const raw = Number.isFinite(seconds) ? seconds * 1000 : 30000;
  return Math.min(120000, Math.max(1000, raw));
}

export function createTools({
  baseUrl = process.env.CODEFALL_FACE_URL || 'http://localhost:8787',
  token = process.env.FACE_HUB_TOKEN || null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = baseUrl.replace(/\/$/, '');

  async function api(path, { method = 'GET', body = null } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        ...(body != null ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const reason = error?.cause?.message || error.message;
      throw new Error(`Face server unreachable at ${base} (${reason}). `
        + 'Start it with: cd server && npm start — then open the face page in a browser.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 200) {
      throw new Error(payload.error || `Face server returned HTTP ${response.status}.`);
    }
    return payload;
  }

  async function command(cmd) {
    return api('/api/face/command', { method: 'POST', body: cmd });
  }

  function requireDelivery(delivered, did) {
    if (!delivered) {
      throw new Error(`No face is connected to the hub, so nothing ${did}. `
        + 'Open the face page in a browser and make sure it attached to /agent-hub.');
    }
    return delivered;
  }

  async function listenOnce(timeoutSeconds) {
    const timeoutMs = clampTimeoutMs(timeoutSeconds);
    const on = await command({ type: 'listen', on: true });
    requireDelivery(on.delivered, 'started listening');
    try {
      const { event } = await api(`/api/face/listen?timeout=${timeoutMs}`);
      if (!event) {
        throw new Error(`Heard nothing within ${Math.round(timeoutMs / 1000)} s. `
          + 'The user may not have spoken, or the face\'s microphone may be off.');
      }
      return event.text;
    } finally {
      await command({ type: 'listen', on: false }).catch(() => {});
    }
  }

  const handlers = {
    async face_speak({ text: say, emotion }) {
      if (!say || typeof say !== 'string') throw new Error('face_speak requires a non-empty "text" string.');
      const body = { text: say, ...(emotion ? { emotion } : {}) };
      const { delivered } = await api('/api/face/say', { method: 'POST', body });
      requireDelivery(delivered, 'was spoken');
      return `Spoken by ${delivered} connected face(s).`;
    },

    async face_emotion({ emotion }) {
      if (!emotion || typeof emotion !== 'string') throw new Error('face_emotion requires an "emotion" string.');
      const { delivered } = await command({ type: 'emotion', emotion });
      requireDelivery(delivered, 'changed expression');
      return `Emotion set to ${emotion} on ${delivered} face(s).`;
    },

    async face_listen({ timeoutSeconds }) {
      const heard = await listenOnce(timeoutSeconds);
      return `User said: ${heard}`;
    },

    async face_ask({ text: say, emotion, timeoutSeconds }) {
      if (!say || typeof say !== 'string') throw new Error('face_ask requires a non-empty "text" string.');
      const body = { text: say, ...(emotion ? { emotion } : {}) };
      const { delivered } = await api('/api/face/say', { method: 'POST', body });
      requireDelivery(delivered, 'was asked');
      const heard = await listenOnce(timeoutSeconds);
      return `User replied: ${heard}`;
    },

    async face_set({ theme, geometry, quality, visualIntensity }) {
      const commands = [];
      if (theme !== undefined) commands.push({ type: 'theme', theme });
      if (geometry !== undefined) commands.push({ type: 'geometry', geometry });
      if (quality !== undefined) commands.push({ type: 'quality', quality });
      if (visualIntensity !== undefined) commands.push({ type: 'visual-intensity', value: visualIntensity });
      if (!commands.length) {
        throw new Error('face_set requires at least one of: theme, geometry, quality, visualIntensity.');
      }
      const results = [];
      for (const cmd of commands) {
        const { delivered } = await command(cmd);
        results.push(`${cmd.type}: ${delivered} face(s)`);
      }
      return `Applied ${results.join(', ')}.`;
    },

    async face_status() {
      const { faces, lastSeq } = await api('/api/face/status');
      return faces > 0
        ? `${faces} face(s) connected. Last event sequence: ${lastSeq}.`
        : 'No faces connected. Open the face page in a browser to attach one.';
    },
  };

  return {
    list() {
      return TOOL_DEFINITIONS;
    },
    async call(name, args = {}) {
      const handler = handlers[name];
      if (!handler) return text(`Unknown tool: ${name}`, true);
      try {
        return text(await handler(args || {}));
      } catch (error) {
        return text(error.message, true);
      }
    },
  };
}

export function runStdioServer({ tools, input = process.stdin, output = process.stdout } = {}) {
  const reply = (message) => output.write(`${JSON.stringify(message)}\n`);
  const respond = (id, result) => reply({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => reply({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  const pending = [];

  async function handle(message) {
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;
      case 'ping':
        respond(id, {});
        return;
      case 'tools/list':
        respond(id, { tools: tools.list() });
        return;
      case 'tools/call': {
        const result = await tools.call(params?.name, params?.arguments || {});
        respond(id, result);
        return;
      }
      default:
        if (!isNotification) fail(id, -32601, `Method not found: ${method}`);
    }
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        fail(null, -32700, 'Parse error');
        return;
      }
      pending.push(handle(message).catch((error) => fail(message.id ?? null, -32603, error.message)));
    });
    rl.on('close', () => {
      Promise.allSettled(pending).then(() => resolve());
    });
  });
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  runStdioServer({ tools: createTools() }).then(() => process.exit(0));
}
