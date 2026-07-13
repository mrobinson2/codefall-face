/**
 * Console UI — the pirate-broadcast control deck around the face.
 * All face logic lives in CodefallFace; this file only wires DOM.
 */

import { CodefallFace } from './codefall-face.js';
import { EMOTION_NAMES } from './face/emotions.js';
import { runDemo, stopDemo } from './demo/demo.js';

const $ = (sel) => document.querySelector(sel);

// ?voice=Ralph — try any installed Web Speech voice by name without
// touching config (list them: speechSynthesis.getVoices() in console).
const urlParams = new URLSearchParams(location.search);
const voiceParam = urlParams.get('voice');
const face = new CodefallFace(
  $('#stage'),
  voiceParam ? { local: { preferredVoices: [voiceParam] } } : {}
);
window.codefall = face; // console access for tinkerers
window.CodefallFace = CodefallFace; // embedding API

// ---- status lamp -----------------------------------------------------
const statusEl = $('#status');
const STATUS_LABEL = {
  booting: 'MATERIALIZING', idle: 'IDLE', listening: 'LISTENING',
  thinking: 'THINKING', speaking: 'SPEAKING', interrupted: 'INTERRUPTED',
  error: 'SIGNAL LOST',
};
face.on('state', ({ state }) => {
  statusEl.textContent = STATUS_LABEL[state] || state.toUpperCase();
  statusEl.dataset.state = state;
  $('#listen').classList.toggle('active', state === 'listening');
  debugLog(`state → ${state}`);
});
face.on('provider', ({ name }) => {
  $('#provider').textContent = `VOICE:${name.toUpperCase()}`;
  debugLog(`provider → ${name}`);
});

// ---- transcript -------------------------------------------------------
const transcriptEl = $('#transcript');
let liveLine = null;
face.on('transcript', ({ role, text, final, via }) => {
  if (!final && role === 'agent') {
    if (!liveLine) {
      liveLine = document.createElement('div');
      liveLine.className = 'line agent';
      transcriptEl.appendChild(liveLine);
    }
    liveLine.textContent += text;
  } else {
    if (liveLine && role === 'agent') {
      liveLine.textContent = text;
      liveLine = null;
    } else if (final) {
      const div = document.createElement('div');
      div.className = `line ${role}`;
      div.textContent = text;
      transcriptEl.appendChild(div);
    }
    if (role === 'user' && final && via !== 'api' && face.adapter?.name === 'local') {
      // Local STT (microphone) has no brain wired — hand the words to
      // ask() so the canned persona answers. Transcripts tagged via:'api'
      // ALREADY came from ask(); re-routing them would loop forever.
      face.ask(text);
    }
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  while (transcriptEl.children.length > 60) transcriptEl.firstChild.remove();
});
face.on('error', ({ message }) => debugLog(`⚠ ${message}`));

// ---- emotion chips -----------------------------------------------------
const chipsEl = $('#emotions');
for (const name of EMOTION_NAMES) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = name;
  b.onclick = () => face.setEmotion(name);
  chipsEl.appendChild(b);
}
face.on('emotion', ({ emotion }) => {
  for (const c of chipsEl.children) c.classList.toggle('active', c.textContent === emotion);
});
face.setEmotion('neutral');

// ---- controls ------------------------------------------------------------
const input = $('#say-input');
async function submitText() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await face.ask(text);
}
$('#say-btn').onclick = submitText;
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitText(); });

let listening = false;
$('#listen').onclick = async () => {
  listening = !listening;
  if (listening) await face.startListening().catch(() => { listening = false; });
  else await face.stopListening();
};

$('#interrupt').onclick = () => { stopDemo(face); face.interrupt(); };

const muteBtn = $('#mute');
muteBtn.onclick = () => {
  face.setMuted(!face.muted);
  muteBtn.textContent = face.muted ? 'UNMUTE' : 'MUTE';
  muteBtn.classList.toggle('active', face.muted);
};

$('#demo').onclick = () => runDemo(face, {
  onBeat: (b) => debugLog(`demo beat: ${b.emotion}`),
});

$('#theme-toggle').onclick = () => {
  face.setTheme(face.theme === 'wintermute' ? 'codefall' : 'wintermute');
  debugLog(`theme → ${face.theme}`);
};

const geometryBtn = $('#geometry-toggle');
function syncGeometryButton() {
  const smooth = face.geometry === 'smooth';
  geometryBtn.textContent = smooth ? '○' : '◇';
  geometryBtn.setAttribute('aria-pressed', String(smooth));
  geometryBtn.setAttribute('aria-label', `Face geometry: ${face.geometry}`);
  geometryBtn.title = `Face geometry: ${face.geometry}`;
}
geometryBtn.onclick = () => {
  face.toggleGeometry();
  syncGeometryButton();
  debugLog(`geometry → ${face.geometry}`);
};
syncGeometryButton();

// ---- console minimize + docking + drag ---------------------------------
const consoleEl = $('#console');
const consoleToggle = $('#console-toggle');
const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

function setCollapsed(collapsed) {
  consoleEl.classList.toggle('collapsed', collapsed);
  consoleToggle.textContent = collapsed ? '▴' : '▾';
  consoleToggle.title = collapsed ? 'Expand panel' : 'Minimize panel';
  localStorage.setItem('codefall-console', collapsed ? 'min' : 'open');
}
consoleToggle.onclick = () => setCollapsed(!consoleEl.classList.contains('collapsed'));
if (localStorage.getItem('codefall-console') === 'min') setCollapsed(true);

function applyDock(dock, pos) {
  consoleEl.dataset.dock = dock;
  if (dock === 'free' && pos) {
    const w = consoleEl.offsetWidth || 400;
    const x = Math.min(Math.max(4, pos.x), window.innerWidth - w - 4);
    const y = Math.min(Math.max(4, pos.y), window.innerHeight - 60);
    consoleEl.style.left = `${x}px`;
    consoleEl.style.top = `${y}px`;
    consoleEl.style.bottom = 'auto';
    consoleEl.style.right = 'auto';
  } else {
    consoleEl.style.left = '';
    consoleEl.style.top = '';
    consoleEl.style.bottom = '';
    consoleEl.style.right = '';
  }
  for (const b of document.querySelectorAll('.dock-btn')) {
    b.classList.toggle('active', b.dataset.dock === dock);
  }
  localStorage.setItem('codefall-dock', JSON.stringify({ dock, pos: pos || null }));
}
for (const b of document.querySelectorAll('.dock-btn')) {
  b.onclick = () => applyDock(b.dataset.dock);
}

// Drag by the header bar (desktop only).
const dragHandle = $('#console-title');
dragHandle.addEventListener('pointerdown', (e) => {
  if (!isDesktop()) return;
  e.preventDefault();
  const rect = consoleEl.getBoundingClientRect();
  const offX = e.clientX - rect.left;
  const offY = e.clientY - rect.top;
  dragHandle.setPointerCapture(e.pointerId);
  let last = null;
  const move = (ev) => {
    last = { x: ev.clientX - offX, y: ev.clientY - offY };
    applyDock('free', last);
  };
  const up = () => {
    dragHandle.removeEventListener('pointermove', move);
    dragHandle.removeEventListener('pointerup', up);
    if (last) applyDock('free', last); // persists final spot
  };
  dragHandle.addEventListener('pointermove', move);
  dragHandle.addEventListener('pointerup', up);
});

// Restore dock preference (default: lower-right, keeping the face clear);
// re-clamp free positions on resize.
try {
  const saved = JSON.parse(localStorage.getItem('codefall-dock') || 'null');
  if (isDesktop()) applyDock(saved?.dock || 'right', saved?.pos);
} catch { /* fresh start */ }
const dockParam = new URLSearchParams(location.search).get('dock');
if (dockParam && isDesktop()) applyDock(dockParam);
window.addEventListener('resize', () => {
  if (consoleEl.dataset.dock === 'free') {
    const r = consoleEl.getBoundingClientRect();
    applyDock('free', { x: r.left, y: r.top });
  }
});

// ---- debug panel ------------------------------------------------------------
const debugEl = $('#debug');
const debugLines = $('#debug-lines');
$('#debug-toggle').onclick = () => debugEl.classList.toggle('open');
function debugLog(msg) {
  const d = document.createElement('div');
  d.textContent = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  debugLines.appendChild(d);
  while (debugLines.children.length > 40) debugLines.firstChild.remove();
  debugLines.scrollTop = debugLines.scrollHeight;
}
setInterval(() => {
  $('#debug-stats').textContent =
    `fps:${face.renderer.fps} grid:${face.renderer.cols}×${face.renderer.rows} ` +
    `coh:${face.coherence.toFixed(2)} mouth:${face.engine.out.open.toFixed(2)}`;
}, 500);

// ---- iOS/Safari audio unlock -------------------------------------------------
// Audio contexts and speechSynthesis need a user gesture on mobile.
const unlock = () => {
  try {
    if (face.adapter?._audioCtx?.state === 'suspended') face.adapter._audioCtx.resume();
    // Prime speechSynthesis with a silent utterance so later calls work.
    if ('speechSynthesis' in window && !unlock._primed) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      unlock._primed = true;
    }
  } catch { /* best effort */ }
};
document.addEventListener('touchend', unlock, { once: false, passive: true });
document.addEventListener('click', unlock, { once: false, passive: true });

// ---- URL params: deep-link a pose (handy for screenshots / GIFs) --------
// ?emotion=anger        — start in an emotion
// ?pose=talk            — animate the mouth continuously without audio
const startEmotion = urlParams.get('emotion');
if (startEmotion) face.setEmotion(startEmotion);
const startTheme = urlParams.get('theme');
if (startTheme) face.setTheme(startTheme);
// ?agent=wss://host/path — connect the agent control channel on boot
const agentUrl = urlParams.get('agent');
if (agentUrl) {
  face.attachAgentSocket(agentUrl);
  debugLog(`agent channel → ${agentUrl}`);
}
if (urlParams.get('pose') === 'talk') {
  face.engine.setSpeaking(true);
  setInterval(() => face.engine.textPulse(3 + Math.random() * 6), 160);
}
