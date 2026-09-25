# Codefall Face — Coding-Agent Integrations (MCP + Claude Code hooks)

Date: 2026-09-24
Status: Approved for autonomous execution via session goal directive.

## Intent

Make Codefall Face a first-class visual TTS/STT companion for coding agents.
A developer running Claude Code or Codex should get, with one registration
command, a face that speaks agent output, shows session state as emotion,
and can capture spoken input back into the agent.

Success criteria:

1. `claude mcp add codefall-face …` (or a Codex `config.toml` block) gives an
   agent working `face_speak` / `face_ask` / `face_listen` tools against a
   locally running face.
2. A documented Claude Code hooks snippet makes the face react to a session
   without the model doing anything: thinking on prompt submit, spoken
   summary on stop, spoken alert on permission notifications.
3. All new logic is covered by the Node test suite; `npm test` stays green.

## Components

### 1. Server agent-hub extraction and upgrade (`server/lib/agent-hub.mjs`)

The hub currently lives inline in `server/server.mjs`, and its HTTP command
allowlist (`speak, ask, emotion, listen, interrupt, mute, theme`) is missing
`geometry`, `quality`, and `visual-intensity`, which the docs and the browser
schema (`src/agent/commands.js`) both promise. Extract the hub into a factory:

```js
createAgentHub({ token, webhook, now?, fetchImpl? }) => {
  handleHttp(req, res, path),      // /api/face/* routes
  handleSocket(ws),                // /agent-hub connections
  authorized(req),
  broadcast(cmd), recordEvent(e),  // exposed for tests
}
```

Behavior:

- Allowlist mirrors the browser schema exactly (all ten command types) and
  performs the same shape validation via a shared validator so the server
  rejects malformed commands before broadcast.
- New `GET /api/face/listen?timeout=<ms>&since=<seq>`: long-poll that
  resolves with the first user transcript event with `seq > since`
  (`{ event, lastSeq }`), or `{ event: null, lastSeq }` on timeout.
  Timeout is clamped to 1..120 s, default 30 s. Multiple concurrent
  waiters are allowed; each resolves independently.
- Existing routes (`status`, `events`, `say`, `command`) keep their
  contracts. `say` remains sugar for `speak`.
- Ring buffer, webhook fan-out, and token auth (`Authorization: Bearer` or
  `?token=`) move verbatim.

`server.mjs` shrinks to wiring. Unit tests hit the factory directly with
mock req/res/ws objects (same style as `server-http-utils.test.js`).

### 2. MCP server (`integrations/mcp/codefall-face-mcp.mjs`)

Zero-dependency stdio MCP server (hand-rolled JSON-RPC 2.0 over
line-delimited stdio, protocol `2025-06-18` with fallback), so it runs with
plain `node` and no install step. Configuration via env:

- `CODEFALL_FACE_URL` (default `http://localhost:8787`)
- `FACE_HUB_TOKEN` (optional, forwarded as bearer)

Tools:

| Tool | Behavior |
|---|---|
| `face_speak` | `{text, emotion?}` → POST `/api/face/say`; returns delivery count |
| `face_emotion` | `{emotion}` → POST `/api/face/command` |
| `face_set` | `{theme? geometry? quality? visualIntensity?}` → one command POST per provided field |
| `face_listen` | `{timeoutSeconds?}` → broadcast `listen on`, long-poll `/api/face/listen`, broadcast `listen off`, return transcript text (or timeout notice) |
| `face_ask` | `{text, emotion?, timeoutSeconds?}` → `face_speak` then `face_listen` |
| `face_status` | GET `/api/face/status` — connected faces, lastSeq |

Errors (face server down, no face connected, timeout) return `isError: true`
tool results with actionable text, never protocol failures. The module
exports its handler map for direct unit testing; the stdio loop only runs
when executed as main.

### 3. Claude Code hooks bridge (`integrations/claude-code/face-hook.mjs`)

One script, invoked by Claude Code hooks, reading the hook event JSON from
stdin. Dispatch on `hook_event_name`:

- `UserPromptSubmit` → `emotion: focus` (face shows "thinking").
- `Stop` → read `transcript_path` (JSONL), find last assistant text, strip
  markdown/code, clamp to `FACE_HOOK_MAX_CHARS` (default 280), speak it.
  `FACE_HOOK_SPEAK=off` disables speech (emotion only); `=status` speaks a
  fixed "Done." instead of the summary; default `summary`.
- `Notification` → speak the notification message (clamped), `emotion: alert`.
- Unknown events → exit 0 silently.

Always exits 0 (never blocks the agent), 2 s fetch timeout, silent when the
face server is unreachable. Ships with `settings-snippet.json` showing the
hooks config and a README covering install for Claude Code and the
equivalent `notify` setup for Codex.

### 4. Docs

- `docs/INTEGRATIONS.md`: new "Claude Code and Codex" section — MCP
  registration one-liners, hooks snippet, env vars, listen round trip.
- `README.md`: short pointer in the External agent channel section.
- `server/.env.example`: no new vars needed; verify hub vars documented.

## Error handling

- Hub long-poll never leaks timers: each waiter clears its timeout on
  resolve; socket-close of the HTTP request cancels the waiter.
- MCP server treats all upstream failures as tool-level errors.
- Hook script wraps everything in try/catch, exit 0.

## Testing

- `test/agent-hub.test.js`: auth, allowlist (all ten types), rejection of
  malformed commands, say sugar, events ring buffer, long-poll resolve /
  timeout / cancel, broadcast delivery counting.
- `test/mcp-server.test.js`: tools/list contract, each tool handler against
  a stubbed fetch, listen round trip, error surfaces.
- `test/claude-code-hook.test.js`: transcript summarization, event mapping,
  clamping, off/status modes, resilience to bad stdin.

## Out of scope

Audio streaming into MCP, Codex-native MCP transports beyond stdio, any UI
changes, auth beyond the existing token.
