/** Browser bootstrap. Product controls live in ControlDeck. */
import { CodefallFace } from './codefall-face.js';
import { ControlDeck } from './ui/control-deck.js';
import { runDemo, stopDemo } from './demo/demo.js';

const params = new URLSearchParams(location.search);
const voice = params.get('voice');
const face = new CodefallFace(
  document.querySelector('#stage'),
  voice ? { local: { preferredVoices: [voice] } } : {},
);
const deck = new ControlDeck({
  root: document,
  face,
  storage: localStorage,
  onDemo: () => runDemo(face),
  onInterrupt: () => stopDemo(face),
});
deck.mount();

window.codefall = face;
window.CodefallFace = CodefallFace;

const startEmotion = params.get('emotion');
if (startEmotion) face.setEmotion(startEmotion);
const startTheme = params.get('theme');
if (startTheme) face.setTheme(startTheme);
const startGeometry = params.get('geometry');
if (startGeometry) face.setGeometry(startGeometry);
const agentUrl = params.get('agent');
if (agentUrl) face.attachAgentSocket(agentUrl);
if (params.get('pose') === 'talk') {
  face.engine.setSpeaking(true);
  window.setInterval(() => face.engine.textPulse(3 + Math.random() * 6), 160);
}

// Audio contexts and speech synthesis require a user gesture on mobile.
const unlock = () => {
  try {
    if (face.adapter?._audioCtx?.state === 'suspended') face.adapter._audioCtx.resume();
    if ('speechSynthesis' in window && !unlock.primed) {
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      speechSynthesis.speak(utterance);
      unlock.primed = true;
    }
  } catch { /* best effort */ }
};
document.addEventListener('touchend', unlock, { passive: true });
document.addEventListener('click', unlock, { passive: true });

window.addEventListener('pagehide', () => {
  deck.destroy();
  face.destroy();
}, { once: true });
