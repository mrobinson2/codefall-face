# Integrations

Codefall Face separates the body from the intelligence driving it. The face can run entirely locally, use a voice relay, or accept commands from an external agent.

## Browser-local voice

The default `provider: 'auto'` probes server-backed providers and falls back to local Web Speech. Use `provider: 'local'` to skip probing. Preferred voices, rate, and pitch live under `local` in `src/config.js`.

Local Web Speech audio cannot be routed through Web Audio, so `voiceFx` only affects providers that expose audio buffers.

## Azure Voice Live

Keep Azure credentials in `server/.env`:

```ini
AZURE_VOICE_LIVE_ENDPOINT=https://YOUR-RESOURCE.cognitiveservices.azure.com
AZURE_VOICE_LIVE_KEY=your-key
AZURE_VOICE_LIVE_MODEL=gpt-4o
AZURE_VOICE_LIVE_API_VERSION=2025-05-01-preview
```

The browser connects to the same-origin `/relay` WebSocket. Provider initialization is generation-scoped, so a late Azure response cannot replace a newer fallback or survive destruction.

## Piper

Run `server/setup-piper.sh`, then configure optional overrides:

```ini
PIPER_BIN=./piper-venv/bin/piper
PIPER_VOICE=./voices/en_US-danny-low.onnx
```

Piper is the fully local neural TTS path. Generated sources and effects are disposed after playback or interruption.

## Lacy

Lacy produces reply text through the backend proxy; the browser speaks the result locally:

```ini
LACY_API_KEY=your-key
LACY_BASE=https://app.lacy.ai/api
LACY_REPLY_PATH=/user/ai/reply
```

Select it with `window.CODEFALL_CONFIG = { provider: 'lacy' }`.

## External agent hub

Configure a shared token and optional event webhook:

```ini
FACE_HUB_TOKEN=choose-a-long-random-string
FACE_EVENTS_WEBHOOK=https://agent.example/webhooks/codefall-face
```

When the face server hosts the page, the browser probes `/api/face/status`
on boot and attaches to `/agent-hub` automatically (configure with
`window.CODEFALL_CONFIG = { agent: { url: 'auto' | '/agent-hub' | null, token } }`;
static deploys stay detached). Attach manually with:

```js
face.attachAgentSocket('/agent-hub?token=YOUR_TOKEN');
```

Drive it over HTTP:

```bash
curl -X POST https://face.example/api/face/say \
  -H "Authorization: Bearer $FACE_HUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"The perimeter has changed.","emotion":"confusion"}'
```

Or post exact commands to `/api/face/command`:

```json
{"type":"geometry","value":"chiseled"}
{"type":"quality","value":"auto"}
{"type":"visual-intensity","value":0.8}
{"type":"speak","text":"I remember another face.","emotion":"sadness"}
```

Accepted types are `speak`, `ask`, `emotion`, `listen`, `interrupt`, `mute`, `theme`, `geometry`, `quality`, and `visual-intensity`. The server validates every command against the same schema the browser enforces, so unknown fields and commands are rejected before broadcast. Command messages are limited to 64 KiB and string fields to 16 KiB.

To capture speech, long-poll `GET /api/face/listen?timeout=30000` after sending `{"type":"listen","on":true}`. The request resolves with the next final user transcript (`{"event":{"text":...},"lastSeq":n}`) or `{"event":null}` on timeout. Timeouts clamp to 1–120 seconds.

On connection, the face sends `hello` with its current snapshot. State, transcript, provider, quality, and visual-event changes are published afterward. During reconnect, only the latest snapshot is retained; transient history is not replayed. Backoff is bounded at 1, 2, 4, 8, and 15 seconds with jitter.

## Claude Code and Codex

The [integrations directory](../integrations/README.md) ships two ready-made bridges:

- **MCP server** (`integrations/mcp/codefall-face-mcp.mjs`) — a zero-dependency stdio MCP server for any MCP client. Register it with `claude mcp add codefall-face -- node .../codefall-face-mcp.mjs` or a Codex `[mcp_servers.codefall_face]` block, and the agent gains `face_speak`, `face_emotion`, `face_ask`, `face_listen`, `face_set`, and `face_status` tools — spoken output and transcribed voice input in one round trip.
- **Claude Code hooks bridge** (`integrations/claude-code/face-hook.mjs`) — makes the face mirror a session passively: focus emotion on prompt submit, a spoken summary when Claude stops, a spoken alert on notifications. Configure with `integrations/claude-code/settings-snippet.json`.

## Wispr Flow and other dictation tools

Dictation tools work through the control deck text field without an adapter. For native hands-free behavior, use the face's listening command so transcripts can also reach the agent channel.

## Production boundary

Do not expose provider relays or the agent hub without TLS, origin restrictions, and upstream authentication. Browser configuration is public. Credentials belong only in environment variables on the server.
