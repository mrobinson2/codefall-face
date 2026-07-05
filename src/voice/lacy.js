/**
 * Lacy.ai adapter — the documented fallback path. Honest scope note:
 *
 * Lacy.ai is a telephony-first platform (AI phone calls, SMS, WhatsApp).
 * As of this writing it does not expose a browser realtime audio SDK,
 * so call audio cannot be streamed into a web page the way Voice Live
 * audio can. What Lacy *does* offer that is useful here is its
 * conversation + AI-reply REST API.
 *
 * This adapter therefore implements a pragmatic hybrid:
 *   brains — user text/transcripts go to Lacy's generate-ai-reply via
 *            the backend proxy (the API key stays server-side)
 *   voice  — the reply is spoken locally with the Web Speech adapter's
 *            synthesis path
 *
 * If Lacy ships a browser WebRTC/WebSocket voice SDK, this file is the
 * single place to swap the synthesis path for real streamed audio.
 */

import { LocalSpeechAdapter } from './local-speech.js';

export class LacyAdapter extends LocalSpeechAdapter {
  constructor(config) {
    super(config);
    this.name = 'lacy';
    this.capabilities.conversational = true;
  }

  async init() {
    await super.init();
    // Verify the proxy is actually configured before claiming readiness.
    const res = await fetch(`${this.config.lacy.proxyBase}/health`).catch(() => null);
    if (!res || !res.ok) {
      throw new Error('Lacy proxy not reachable — run server/server.mjs with LACY_API_KEY set');
    }
  }

  /** Ask Lacy for a reply to `text`, then speak it. */
  async converse(text) {
    this.emit('statechange', { state: 'thinking' });
    const res = await fetch(`${this.config.lacy.proxyBase}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      this.emit('error', { message: `Lacy reply failed (${res.status})` });
      return null;
    }
    const data = await res.json();
    const reply = data.reply || data.message || data.text;
    if (reply) {
      this.emit('transcript', { role: 'agent', text: reply, final: true });
      await this.speak(reply);
    }
    return reply;
  }
}
