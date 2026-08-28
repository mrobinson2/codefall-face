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

Connect the page:

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

Accepted types are `speak`, `ask`, `emotion`, `listen`, `interrupt`, `mute`, `theme`, `geometry`, `quality`, and `visual-intensity`. Unknown fields and commands are rejected. Command messages are limited to 64 KiB and string fields to 16 KiB.

On connection, the face sends `hello` with its current snapshot. State, transcript, provider, quality, and visual-event changes are published afterward. During reconnect, only the latest snapshot is retained; transient history is not replayed. Backoff is bounded at 1, 2, 4, 8, and 15 seconds with jitter.

## Wispr Flow and other dictation tools

Dictation tools work through the control deck text field without an adapter. For native hands-free behavior, use the face's listening command so transcripts can also reach the agent channel.

## Production boundary

Do not expose provider relays or the agent hub without TLS, origin restrictions, and upstream authentication. Browser configuration is public. Credentials belong only in environment variables on the server.
