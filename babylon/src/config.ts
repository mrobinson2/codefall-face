export const moodPresets = {
  happy: { primary: "#c4ccc8", accent: "#879a94", tendrils: 0.25 },
  content: { primary: "#a9b4c2", accent: "#697b91", tendrils: 0.21 },
  angry: { primary: "#ac9b8e", accent: "#795f54", tendrils: 0.16 },
};

export type Mood = keyof typeof moodPresets;

export const sceneSettings = {
  defaultMood: "content" as const,
  revealDuration: 4.2,
  energy: {
    tendrilCount: 62,
    particlesPerTendril: 12,
    streamSpeed: 1,
  },
  bloom: {
    threshold: 0.28,
    weight: 0.58,
    kernel: 56,
    scale: 0.5,
  },
  maxPixelRatio: 1.5,
};
