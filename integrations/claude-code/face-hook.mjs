#!/usr/bin/env node
/**
 * Claude Code / Codex → Codefall Face hook bridge.
 *
 * Claude Code pipes each hook event as JSON on stdin; Codex's `notify`
 * setting passes its notification JSON as the final argv. Either way this
 * script maps the event to face commands so the face mirrors the session:
 * focus while the agent works, a spoken summary when it stops, a spoken
 * alert when it needs attention. See settings-snippet.json for the Claude
 * Code hooks configuration; for Codex add to ~/.codex/config.toml:
 *
 *   notify = ["node", "/path/to/integrations/claude-code/face-hook.mjs"]
 *
 * Env:
 *   CODEFALL_FACE_URL    face server (default http://localhost:8787)
 *   FACE_HUB_TOKEN       optional bearer token
 *   FACE_HOOK_SPEAK      summary (default) | status | off
 *   FACE_HOOK_MAX_CHARS  spoken summary limit (default 280)
 *
 * Always exits 0 — a missing face must never block the coding agent.
 */

import process from 'node:process';
import { readFileSync } from 'node:fs';

const DEFAULT_MAX_CHARS = 280;
const FETCH_TIMEOUT_MS = 2000;

/** Reduce markdown to speakable prose: drop code blocks, keep link text. */
function speakable(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > maxChars * 0.5 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Last assistant text from a Claude Code transcript (JSONL), or null. */
export function summarizeTranscript(jsonl, maxChars = DEFAULT_MAX_CHARS) {
  if (!jsonl || typeof jsonl !== 'string') return null;
  let last = null;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.message?.role !== 'assistant') continue;
    const content = entry.message.content;
    const text = Array.isArray(content)
      ? content.filter((block) => block?.type === 'text').map((block) => block.text).join(' ')
      : typeof content === 'string' ? content : '';
    if (text.trim()) last = text;
  }
  if (!last) return null;
  const spoken = speakable(last);
  return spoken ? clamp(spoken, maxChars) : null;
}

/**
 * Map one hook event to face commands.
 * Returns [{ path: '/api/face/say' | '/api/face/command', body }].
 */
export function mapHookEvent(event, {
  mode = 'summary',
  maxChars = DEFAULT_MAX_CHARS,
  readFile = (path) => readFileSync(path, 'utf8'),
} = {}) {
  const say = (text, emotion) => ({ path: '/api/face/say', body: { text, ...(emotion ? { emotion } : {}) } });
  const emote = (emotion) => ({ path: '/api/face/command', body: { type: 'emotion', emotion } });

  switch (event?.hook_event_name) {
    case 'UserPromptSubmit':
      return [emote('focus')];

    case 'Stop': {
      if (mode === 'off') return [emote('neutral')];
      if (mode === 'status') return [say('Done.')];
      let summary = null;
      try {
        summary = summarizeTranscript(readFile(event.transcript_path), maxChars);
      } catch { /* transcript unreadable — fall back below */ }
      return [say(summary || 'Done.')];
    }

    case 'Notification': {
      if (mode === 'off') return [emote('alert')];
      const message = typeof event.message === 'string' && event.message.trim()
        ? clamp(speakable(event.message), maxChars)
        : 'Attention needed.';
      return [say(message, 'alert')];
    }

    default:
      break;
  }

  // Codex notify payloads carry `type` instead of `hook_event_name`.
  if (event?.type === 'agent-turn-complete') {
    if (mode === 'off') return [emote('neutral')];
    const message = event['last-assistant-message'];
    const spoken = mode !== 'status' && typeof message === 'string' && message.trim()
      ? clamp(speakable(message), maxChars)
      : null;
    return [say(spoken || 'Done.')];
  }

  return [];
}

export async function runHook({
  input,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  try {
    const event = JSON.parse(input);
    const commands = mapHookEvent(event, {
      mode: env.FACE_HOOK_SPEAK || 'summary',
      maxChars: Number(env.FACE_HOOK_MAX_CHARS) || DEFAULT_MAX_CHARS,
    });
    const base = (env.CODEFALL_FACE_URL || 'http://localhost:8787').replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (env.FACE_HUB_TOKEN) headers.Authorization = `Bearer ${env.FACE_HUB_TOKEN}`;
    for (const { path, body } of commands) {
      await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout?.(FETCH_TIMEOUT_MS),
      }).catch(() => {});
    }
  } catch { /* never block the agent */ }
  return 0;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  // Codex `notify` passes the payload as the final argv; Claude Code hooks
  // pipe it on stdin.
  const argvJson = process.argv.slice(2).find((arg) => arg.trimStart().startsWith('{'));
  if (argvJson) {
    runHook({ input: argvJson }).then((code) => process.exit(code));
  } else {
    let stdin = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { stdin += chunk; });
    process.stdin.on('end', async () => {
      process.exit(await runHook({ input: stdin }));
    });
  }
}
