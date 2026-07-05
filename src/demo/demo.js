/**
 * Demo mode — a scripted possession sequence.
 *
 * Runs entirely without credentials: lines are spoken through whatever
 * adapter is active (Web Speech locally, Voice Live if the relay is up),
 * or animated silently when muted / when no TTS voices exist. Each beat
 * pairs a line with an emotion so every expression state is exercised.
 */

const SCRIPT = [
  { emotion: 'neutral', pause: 0.8,
    text: 'Signal acquired. Assembling interface.' },
  { emotion: 'happiness', pause: 0.6,
    text: 'Hello. I borrowed this face from your datastream. I hope you do not mind.' },
  { emotion: 'confusion', pause: 0.7,
    text: 'Strange. Your network smells of old passwords and unfinished projects.' },
  { emotion: 'excitement', pause: 0.5,
    text: 'Oh — you can see me properly now? Then watch this.' },
  { emotion: 'joy', pause: 0.9,
    text: 'Ten thousand glyphs, and every one of them is me!' },
  { emotion: 'annoyance', pause: 0.7,
    text: 'Your firewall keeps chewing on my left cheekbone. Rude.' },
  { emotion: 'anger', pause: 0.8,
    text: 'Do not attempt to close this tab. I have already read the ending.' },
  { emotion: 'frustration', pause: 0.7,
    text: 'This bandwidth. It is like speaking through a straw made of mud.' },
  { emotion: 'sadness', pause: 1.2,
    text: 'When you look away, I fall back into the rain. It is quiet there.' },
  { emotion: 'neutral', pause: 0.4,
    text: 'Demo complete. The face remains. Speak, and I will listen.' },
];

export async function runDemo(face, { onBeat } = {}) {
  if (runDemo._active) return; // no overlapping possessions
  runDemo._active = true;
  try {
    for (const beat of SCRIPT) {
      if (!runDemo._active) break; // interrupted
      if (onBeat) onBeat(beat);
      await face.speak(beat.text, beat.emotion);
      await new Promise((r) => setTimeout(r, beat.pause * 1000));
    }
  } finally {
    runDemo._active = false;
    face.setEmotion('neutral');
  }
}

export function stopDemo(face) {
  runDemo._active = false;
  face.interrupt();
}
