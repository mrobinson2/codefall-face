# Coding-agent integrations

Codefall Face as a visual TTS/STT companion for Claude Code and Codex.
Both integrations talk to the face server's agent hub, so start that first:

```bash
cd server && npm start   # http://localhost:8787
```

Open `http://localhost:8787` in a browser — the page detects the face
server and attaches to the agent hub automatically. If you set
`FACE_HUB_TOKEN` on the server, pass the same value to the integrations
below and give the page the token too, either via
`window.CODEFALL_CONFIG = { agent: { token: '...' } }` or by opening
`http://localhost:8787/?agent=/agent-hub%3Ftoken%3D...`.

## MCP server (Claude Code and Codex)

`mcp/codefall-face-mcp.mjs` is a zero-dependency stdio MCP server. It gives
the agent six tools: `face_speak`, `face_emotion`, `face_ask` (speak a
question, return the spoken reply), `face_listen` (STT capture),
`face_set` (theme / geometry / quality / intensity), and `face_status`.

Claude Code:

```bash
claude mcp add codefall-face \
  --env CODEFALL_FACE_URL=http://localhost:8787 \
  -- node /path/to/codefall-face/integrations/mcp/codefall-face-mcp.mjs
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.codefall_face]
command = "node"
args = ["/path/to/codefall-face/integrations/mcp/codefall-face-mcp.mjs"]
env = { CODEFALL_FACE_URL = "http://localhost:8787" }
```

Add `FACE_HUB_TOKEN` to the env when the hub requires one. Then ask the
agent to "say the test results out loud" or "ask me which branch to use and
wait for my answer" — the reply arrives as transcribed speech.

## Claude Code hooks bridge

`claude-code/face-hook.mjs` makes the face mirror a Claude Code session
without the model doing anything:

| Session event | Face reaction |
|---|---|
| You submit a prompt | `focus` emotion — the face concentrates |
| Claude finishes a turn | Speaks a short summary of the reply |
| Claude needs attention (permission, idle) | Speaks the notification with an `alert` emotion |

Merge `claude-code/settings-snippet.json` into `~/.claude/settings.json`
(fix the path), or add the three hooks with `/hooks` inside Claude Code.

Tune it with environment variables on the hook command:

- `FACE_HOOK_SPEAK` — `summary` (default), `status` (just says "Done."),
  or `off` (emotions only, no speech).
- `FACE_HOOK_MAX_CHARS` — spoken summary length limit (default 280).
- `CODEFALL_FACE_URL`, `FACE_HUB_TOKEN` — where the face server lives.

The hook always exits 0 and times out after two seconds, so a stopped face
server never slows the session down.

## Codex notifications

The same hook script understands Codex `notify` payloads. In
`~/.codex/config.toml`:

```toml
notify = ["node", "/path/to/codefall-face/integrations/claude-code/face-hook.mjs"]
```

When a Codex turn completes, the face speaks the last assistant message
(clamped, markdown stripped), honoring the same `FACE_HOOK_SPEAK` modes.

## Both at once

They compose: the hooks bridge gives ambient presence (state and spoken
summaries for free), while the MCP tools let the model deliberately speak,
ask, and listen. Voice replies to `face_ask` come from the browser's
speech recognition; use Chrome for the best Web Speech support.
