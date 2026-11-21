import { createHushVoice, type VoiceState } from "./voice";

const stateText: Record<VoiceState, string> = {
  offline: "Voice is off. Type a message or start the microphone.",
  connecting: "Connecting to Azure Voice Live…",
  idle: "Ready to talk.",
  listening: "Listening. Speak, then pause for a reply.",
  thinking: "The Hush is thinking…",
  speaking: "The Hush is speaking.",
};

export function setupVoicePanel(panel: HTMLDetailsElement) {
  const form = panel.querySelector<HTMLFormElement>("form")!;
  const input = panel.querySelector<HTMLInputElement>("input")!;
  const send = panel.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const mic = panel.querySelector<HTMLButtonElement>("#voice-mic")!;
  const interrupt = panel.querySelector<HTMLButtonElement>("#voice-interrupt")!;
  const disconnect = panel.querySelector<HTMLButtonElement>("#voice-disconnect")!;
  const status = panel.querySelector<HTMLElement>("#voice-status")!;
  const heard = panel.querySelector<HTMLElement>("#voice-heard")!;
  const reply = panel.querySelector<HTMLElement>("#voice-reply")!;
  let epoch = 0;
  let listening = false;
  let state: VoiceState = "offline";

  function setLine(element: HTMLElement, text: string) {
    element.textContent = text;
    element.hidden = !text;
  }

  const voice = createHushVoice({
    onState(next) {
      if (next === "thinking" && state !== "thinking") setLine(reply, "");
      state = next;
      status.textContent = stateText[state];
      interrupt.disabled = state !== "thinking" && state !== "speaking";
      disconnect.disabled = state === "offline";
    },
    onListening(active) {
      listening = active;
      mic.textContent = active ? "Stop microphone" : "Start microphone";
      mic.setAttribute("aria-pressed", String(active));
    },
    onTranscript({ role, text, final }) {
      const output = role === "user" ? heard : reply;
      if (typeof text !== "string") return;
      if (role === "user" && !final) return;
      const next = final ? text : (output.textContent ?? "") + text;
      setLine(output, next.slice(0, 4000));
    },
    onError(message) {
      status.textContent = message;
    },
  });

  function endConversation() {
    epoch++;
    voice.disconnect();
    mic.disabled = send.disabled = false;
    setLine(heard, "");
    setLine(reply, "");
  }

  async function run(button: HTMLButtonElement, operation: () => Promise<void>, restore?: () => void) {
    const current = epoch;
    button.disabled = true;
    try {
      await operation();
    } catch (error) {
      if (current !== epoch) return;
      restore?.();
      status.textContent = error instanceof Error && error.name === "NotAllowedError"
        ? "Microphone access was denied. You can still type a message."
        : error instanceof Error ? error.message : "Voice is unavailable.";
    } finally {
      if (current === epoch) button.disabled = false;
    }
  }

  mic.addEventListener("click", () => {
    void run(mic, () => voice.setListening(!listening));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (send.disabled || !text) return;
    setLine(heard, text);
    setLine(reply, "");
    input.value = "";
    void run(send, () => voice.ask(text), () => {
      if (!input.value) input.value = text;
    });
  });
  interrupt.addEventListener("click", () => voice.interrupt());
  disconnect.addEventListener("click", endConversation);
  panel.addEventListener("toggle", () => {
    if (!panel.open) endConversation();
  });
  window.addEventListener("pagehide", endConversation);

  return voice;
}
