import { SpeechEngine } from "../../src/speech/speech-engine.js";
import { AzureVoiceLiveAdapter } from "../../src/voice/azure-voice-live.js";

export type HushStoryPhase = "friendly" | "uneasy" | "revealed";
export type VoiceState = "offline" | "connecting" | "idle" | "listening" | "thinking" | "speaking";
type Transcript = { role: "user" | "agent"; text: string; final: boolean };

type VoiceOptions = {
  voiceName?: string;
  relayUrl?: string;
  healthUrl?: string;
  workletUrl?: string;
  onState?: (state: VoiceState) => void;
  onListening?: (listening: boolean) => void;
  onTranscript?: (transcript: Transcript) => void;
  onError?: (message: string) => void;
};

const phases: Record<HushStoryPhase, string> = {
  friendly: "You are patient, reassuring and apparently helpful. Offer small comforts, like company or a moment of quiet. The player is meeting you early; do not invent darker lore or reveal any future plot.",
  uneasy: "You still sound kind, but you are starting to deflect questions about your promises. Speak of an offer of peace and pleasure. Leave the cost unstated and avoid revealing the final act.",
  revealed: "The player knows the truth. You are a demonic trickster who concealed the cost of your offer. In this fictional story, accepting your bargain would cost their character's soul. Admit your deception calmly when challenged.",
};

function instructions(phase: HushStoryPhase) {
  return [
    "You voice The Hush, an original fictional character in a video game. Stay in character with one or two short sentences per reply. Use plain dialogue with no stage directions, formatting, or narration.",
    phases[phase],
    "The game determines quest outcomes, story progress, and bargains. Conversation alone never accepts an offer or changes player state. Keep all offers fictional and never ask for money, secrets, or personal details.",
  ].join(" ");
}

function sameOriginRelay() {
  const relay = new URL("/relay", location.href);
  relay.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return relay.href;
}

const textLimit = 1000;

function dialogueText(value: string) {
  const text = value.trim();
  if (!text || text.length > textLimit) throw new Error("Enter between 1 and 1000 characters.");
  return text;
}

export function createHushVoice(options: VoiceOptions = {}) {
  const speech = new SpeechEngine();
  let phase: HushStoryPhase = "friendly";
  let adapter: AzureVoiceLiveAdapter | null = null;
  let pending: Promise<AzureVoiceLiveAdapter> | null = null;
  let healthRequest: AbortController | null = null;
  let speaking = false;
  let listening = false;
  let settleUntil = 0;

  function disconnect() {
    const old = adapter;
    adapter = null;
    pending = null;
    healthRequest?.abort();
    healthRequest = null;
    speaking = false;
    listening = false;
    speech.setSpeaking(false);
    settleUntil = performance.now() + 450;
    speech.detach();
    old?.destroy();
    options.onListening?.(false);
    options.onState?.("offline");
  }

  function connect() {
    if (pending) return pending;
    if (adapter) return Promise.resolve(adapter);
    const candidate = new AzureVoiceLiveAdapter({
      azure: {
        relayUrl: options.relayUrl ?? sameOriginRelay(),
        voice: options.voiceName ?? "en-US-GuyNeural",
        instructions: instructions(phase),
        // esbuild places scene.js in /babylon, beside the site's /src directory.
        workletUrl: options.workletUrl ?? new URL("../src/voice/azure-pcm-capture.js", import.meta.url).href,
      },
      voiceFx: { enabled: false },
    });
    adapter = candidate;
    const initialPhase = phase;
    const request = healthRequest = new AbortController();
    const timeout = setTimeout(() => request.abort(), 5000);
    const listen = <Detail>(event: string, callback: (detail: Detail) => void) => {
      candidate.addEventListener(event, (value) => {
        if (adapter === candidate) callback((value as CustomEvent<Detail>).detail);
      });
    };
    listen<{ ctx: AudioContext; node: AudioNode }>("audionode", ({ ctx, node }) => speech.attachAnalyser(ctx, node));
    listen("speechstart", () => {
      speaking = true;
      speech.setSpeaking(true);
      options.onState?.("speaking");
    });
    listen("speechend", () => {
      speaking = false;
      speech.setSpeaking(false);
      settleUntil = performance.now() + 450;
      options.onState?.(listening ? "listening" : "idle");
    });
    listen<{ listening: boolean }>("listeningchange", (detail) => {
      listening = detail.listening;
      options.onListening?.(listening);
    });
    listen<{ state: VoiceState }>("statechange", ({ state }) => options.onState?.(state));
    listen<Transcript>("transcript", (transcript) => options.onTranscript?.(transcript));
    listen<{ message: string; fatal?: boolean }>("error", ({ message, fatal }) => {
      if (fatal) disconnect();
      options.onError?.(message);
    });

    options.onState?.("connecting");
    // Unlock playback within the button or form gesture, before awaiting the health check.
    pending = Promise.all([
      candidate.unlockAudio(),
      (async () => {
        let health: Response;
        try {
          health = await fetch(options.healthUrl ?? "/api/voice/health", {
            cache: "no-store",
            signal: request.signal,
          });
        } catch {
          throw new Error("The voice server is unavailable.");
        } finally {
          clearTimeout(timeout);
        }
        if (!health.ok) throw new Error("Voice requires the Codefall Face voice server.");
        if ((await health.json()).available !== true) throw new Error("Azure Voice Live is not configured on the server.");
        if (adapter !== candidate) throw new Error("Voice session closed.");
        await candidate.init();
      })(),
    ]).then(() => {
      if (adapter !== candidate) throw new Error("Voice session closed.");
      pending = null;
      healthRequest = null;
      if (phase !== initialPhase) candidate.updateInstructions(instructions(phase));
      options.onState?.("idle");
      return candidate;
    }).catch((error) => {
      if (adapter === candidate) disconnect();
      throw error;
    });
    return pending;
  }

  return {
    connect,
    async setListening(enabled: boolean) {
      if (enabled) {
        const current = await connect();
        await current.startListening();
      } else {
        await adapter?.stopListening();
      }
    },
    async ask(text: string) {
      const input = dialogueText(text);
      const current = await connect();
      await current.ask(input);
    },
    async speak(text: string) {
      const input = dialogueText(text);
      const current = await connect();
      await current.speak(input);
    },
    setStoryPhase(value: HushStoryPhase) {
      if (!Object.hasOwn(phases, value)) throw new Error("Unknown story phase.");
      if (phase === value) return;
      phase = value;
      if (adapter && !pending) adapter.updateInstructions(instructions(phase));
    },
    interrupt() {
      adapter?.interrupt();
    },
    disconnect,
    needsFrame() {
      return speaking || performance.now() < settleUntil || speech.out.open > 0.001 || speech.out.wide > 0.001;
    },
    isSpeaking() {
      return speaking;
    },
    tick(seconds: number) {
      speech.tick(seconds);
      return speech.out;
    },
  };
}
