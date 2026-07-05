# Wiring up Codefall Face

Step-by-step guides for each voice / agent integration. All of them are
independent — mix and match. Nothing here is required for the face
itself: with zero configuration it runs on the local Web Speech provider.

---

## 1. Azure Voice Live (real-time voice, the primary path)

What you get: streaming conversational voice — the face speaks with an
Azure neural voice, hears the mic through server-side STT, supports
barge-in interruption, and the mouth animates from the actual audio
waveform.

**Prerequisites:** an Azure AI Foundry (Cognitive Services) resource in
a region with Voice Live availability, and its endpoint + key.

1. Copy the env template and fill in your resource:

   ```bash
   cd server
   cp .env.example .env
   ```

   ```ini
   AZURE_VOICE_LIVE_ENDPOINT=https://YOUR-RESOURCE.cognitiveservices.azure.com
   AZURE_VOICE_LIVE_KEY=<key from Azure portal → Keys and Endpoint>
   AZURE_VOICE_LIVE_MODEL=gpt-4o
   AZURE_VOICE_LIVE_API_VERSION=2025-05-01-preview
   ```

2. Start the server with those vars loaded:

   ```bash
   export $(grep -v '^#' .env | xargs) && npm start
   ```

   The boot banner should say `Voice Live relay: ARMED`.

3. Open `http://localhost:8787`. The header should read `VOICE:AZURE`.
   If the relay is unreachable the face auto-falls back to `VOICE:LOCAL`.

4. Pick the voice and persona in `src/config.js` (`azure.voice`,
   `azure.instructions`), or override per deployment with
   `window.CODEFALL_CONFIG` in `index.html`.

**Why the relay exists:** browsers cannot send auth headers on
WebSockets, so the key lives in the Node process and frames are piped
verbatim. Never put the key in client code or a query string.

**Troubleshooting**
- `VOICE:LOCAL` when you expected Azure → the relay refused (missing env
  vars) or the WS handshake failed. Check the server banner and browser
  debug panel (▚ button).
- Serving the page over HTTPS? The relay must be `wss://` — put the Node
  server behind your TLS proxy and set
  `CODEFALL_CONFIG.azure.relayUrl = 'wss://yourhost/relay'`.
- Protocol errors after a Microsoft api-version bump: the touch points
  are `src/voice/azure-voice-live.js` and `AZURE_VOICE_LIVE_API_VERSION`.

---

## 2. Hermes (or any agent gateway) via the agent hub

What you get: a server-side agent that *possesses* the face — it speaks
through it with chosen emotions and hears the human's transcripts.

1. Generate a hub token and start the server with it:

   ```bash
   # in server/.env
   FACE_HUB_TOKEN=<long random string>
   # optional: push face events to your agent instead of polling
   FACE_EVENTS_WEBHOOK=https://your-gateway/webhooks/codefall-face
   ```

2. Open the face with the agent channel connected (URL-encode the token
   into the path):

   ```
   http://localhost:8787/?agent=%2Fagent-hub%3Ftoken%3D<token>
   ```

   Or from code: `face.attachAgentSocket('/agent-hub?token=<token>')`.

3. Give your agent a "face" tool. It is one HTTP call:

   ```bash
   curl -X POST https://yourhost/api/face/say \
     -H "Authorization: Bearer $FACE_HUB_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"text":"Gate opened. Three anomalies overnight.","emotion":"annoyance"}'
   ```

   A typical tool definition for the agent's prompt/config:

   > `face_speak(text, emotion)` — say `text` aloud through the Codefall
   > Face with one of: neutral, confusion, annoyance, anger, frustration,
   > excitement, happiness, joy, sadness. Use emotions sparingly and
   > deliberately.

   Other commands go to `POST /api/face/command` with
   `{"type": "emotion"|"listen"|"interrupt"|"mute"|"theme", ...}`.

4. Hear the human. Two options:
   - **Webhook** (recommended): every face event arrives as a JSON POST
     to `FACE_EVENTS_WEBHOOK` — route `{"type":"transcript","role":"user",
     "final":true,...}` into the agent as an incoming message.
   - **Polling**: `GET /api/face/events?since=<lastSeq>` with the token.

5. Exposure beyond localhost: put the whole server behind your existing
   TLS/auth layer (e.g. a Cloudflare Tunnel with Access). The hub token
   is defense in depth, not a substitute for transport security.

The loop end-to-end: human speaks → face STT emits `transcript` → hub →
webhook → agent thinks → agent calls `face_speak` → hub broadcasts →
face speaks with the emotion. The face is a body; the agent is the ghost.

---

## 3. Wispr Flow (dictation)

Nothing to integrate. Wispr Flow types into whatever field has focus:

1. Click the **transmit words to the ghost…** input.
2. Dictate with Flow.
3. Press Enter (or TALK).

The text goes through `ask()` — with an agent connected, the agent
answers; otherwise the current provider handles it. For hands-free use
prefer the **LISTEN** button (browser STT) or the Azure path, both of
which stream transcripts to any connected agent automatically.

---

## 4. Lacy.ai (fallback, with an honest caveat)

Lacy.ai is telephony-first (AI phone calls, SMS, WhatsApp). It does not
currently offer a browser realtime audio SDK, so this adapter is a
hybrid: **Lacy generates the reply text** (via your account's AI), and
the browser **speaks it with local synthesis**.

1. In `server/.env`:

   ```ini
   LACY_API_KEY=<your Lacy API key>
   LACY_BASE=https://app.lacy.ai/api
   LACY_REPLY_PATH=/user/ai/reply   # adjust to your account's endpoint
   ```

2. Select the provider in the page config:

   ```html
   <script>window.CODEFALL_CONFIG = { provider: 'lacy' };</script>
   ```

3. The adapter health-checks `/api/lacy/health` at boot and reports
   clearly if the proxy isn't configured.

If Lacy ships browser voice streaming, `src/voice/lacy.js` is the single
file to upgrade from synthesized playback to real streamed audio.
