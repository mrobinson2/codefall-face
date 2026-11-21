import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createBackdrop } from "./backdrop";
import { moodPresets, sceneSettings, type Mood } from "./config";
import { createEnergy } from "./energy";
import { createFace } from "./face";
import { setupVoicePanel } from "./voice-panel";

const canvas = document.querySelector<HTMLCanvasElement>("#portrait")!;
const status = document.querySelector<HTMLElement>("#status")!;
const controls = document.querySelector<HTMLElement>("#controls")!;
const orbitHint = document.querySelector<HTMLElement>("#orbit-hint")!;
const motion = document.querySelector<HTMLButtonElement>("#motion")!;
const replay = document.querySelector<HTMLButtonElement>("#replay")!;
const voicePanel = document.querySelector<HTMLDetailsElement>("#voice-panel")!;
const speed = document.querySelector<HTMLInputElement>("#speed")!;
const primary = document.querySelector<HTMLInputElement>("#primary")!;
const accent = document.querySelector<HTMLInputElement>("#accent")!;
const moodButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mood]")];

function readMood(value: string | null): Mood {
  return value === "happy" || value === "content" || value === "angry" ? value : sceneSettings.defaultMood;
}

function ramp(time: number, start: number, end: number) {
  const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

async function start() {
  if (!Engine.isSupported()) {
    status.textContent = "This browser couldn’t start WebGL. Try the Canvas 2D version.";
    return;
  }

  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;

  const front = -Math.PI / 2;
  const portraitDistance = 5.55;
  const camera = new ArcRotateCamera("portrait-camera", front, 1.55, portraitDistance,
    new Vector3(0, -0.06, 0), scene);
  camera.fov = 0.65;
  camera.minZ = 0.1;
  camera.maxZ = 32;
  camera.lowerAlphaLimit = front - 0.48;
  camera.upperAlphaLimit = front + 0.48;
  camera.lowerBetaLimit = 1.27;
  camera.upperBetaLimit = 1.84;
  camera.panningSensibility = 0;
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.attachControl(canvas, true);

  const bounce = new HemisphericLight("ambient", new Vector3(0, 0.65, -0.8), scene);

  // Keep broad fill across the face and concentrate the brightest highlights on the brow and crown.
  const fill = new DirectionalLight("fill", new Vector3(-0.32, -0.48, 0.85), scene);
  const rim = new DirectionalLight("rim", new Vector3(1, -0.24, -0.12), scene);
  const lampPosition = new Vector3(-0.43, 1.72, -2.18);
  const lampDirection = new Vector3(0.02, 0.77, -0.57).subtract(lampPosition).normalize();
  const key = new SpotLight("overhead key", lampPosition, lampDirection, 1.02, 16, scene);
  key.diffuse.set(1, 0.96, 0.91);
  key.specular.set(1, 0.98, 0.94);

  const backdrop = createBackdrop(scene);
  const portrait = new TransformNode("portrait", scene);
  const url = new URL(location.href);
  let mood = readMood(url.searchParams.get("mood"));
  const theme = { primary: Color3.Black(), accent: Color3.Black() };
  const face = createFace(scene, portrait, theme);
  const energy = createEnergy(scene, portrait, theme, sceneSettings.energy);
  const voice = setupVoicePanel(voicePanel);

  const pipeline = new DefaultRenderingPipeline("portrait-bloom", true, scene, [camera]);
  pipeline.bloomScale = sceneSettings.bloom.scale;
  pipeline.bloomThreshold = sceneSettings.bloom.threshold;
  pipeline.bloomWeight = sceneSettings.bloom.weight;
  pipeline.bloomKernel = sceneSettings.bloom.kernel;
  pipeline.bloomEnabled = true;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;

  const duration = sceneSettings.revealDuration;

  function applyReveal() {
    const t = revealTime / duration;
    const outline = ramp(t, 0.12, 0.68);
    const surface = ramp(t, 0.23, 0.91);
    const surroundings = ramp(t, 0.51, 1);
    const angry = mood === "angry";

    // Reveal the form with light, retaining its depth and occlusion throughout the entrance.
    rim.intensity = (angry ? 0.33 : 0.42) * (0.11 + 0.89 * outline);
    bounce.intensity = 0.24 * (0.012 + 0.988 * outline);
    fill.intensity = (angry ? 0.29 : 0.43) * (0.009 + 0.991 * outline);
    key.intensity = (angry ? 2.25 : 2.05) * (0.002 + 0.998 * surface);
    face.setEyeIntensity(0.13 + 0.87 * ramp(t, 0.06, 0.85));
    energy.setIntensity(moodPresets[mood].tendrils * surroundings);
    backdrop.setIntensity(surroundings);
  }

  function applyColors() {
    theme.primary.copyFrom(Color3.FromHexString(primary.value));
    theme.accent.copyFrom(Color3.FromHexString(accent.value));
    fill.diffuse = Color3.Lerp(Color3.White(), theme.primary, 0.26);
    rim.diffuse = Color3.Lerp(Color3.White(), theme.accent, 0.55);
    bounce.diffuse = Color3.Lerp(Color3.White(), theme.accent, 0.29);
    bounce.groundColor = theme.accent.scale(0.075);
    backdrop.setColors(theme);
    face.setColors(theme);
    energy.setColors(theme);
    document.documentElement.style.setProperty("--signal", primary.value);
    needsRender = true;
  }

  function setMood(value: Mood) {
    mood = value;
    const preset = moodPresets[mood];
    primary.value = preset.primary;
    accent.value = preset.accent;
    face.setMood(mood);
    for (const button of moodButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.mood === mood));
    }
    applyColors();
    applyReveal();
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, sceneSettings.maxPixelRatio);
    engine.setHardwareScalingLevel(1 / ratio);
    engine.resize();
    const aspect = engine.getAspectRatio(camera);
    backdrop.resize(aspect);
    // Fill portrait screens with the face and let the longest strands extend past the edges.
    const radius = Math.max(portraitDistance, 4.15 / aspect);
    camera.lowerRadiusLimit = camera.upperRadiusLimit = camera.radius = radius;
    needsRender = true;
  }

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let playing = !reducedMotion.matches;
  let time = 3.1;
  let flowTime = time;
  let revealTime = playing ? 0 : duration;
  let needsRender = true;
  let lastCameraMove = 0;

  function setPlaying(value: boolean) {
    playing = value;
    motion.setAttribute("aria-pressed", String(playing));
    if (!playing) {
      revealTime = duration;
      applyReveal();
    }
    needsRender = true;
  }

  setPlaying(playing);
  setMood(mood);
  resize();
  await scene.whenReadyAsync();
  status.hidden = true;
  controls.hidden = false;
  orbitHint.hidden = false;
  replay.hidden = false;
  voicePanel.hidden = false;

  window.addEventListener("resize", resize);
  reducedMotion.addEventListener("change", (event) => setPlaying(!event.matches));
  motion.addEventListener("click", () => setPlaying(!playing));
  replay.addEventListener("click", () => {
    revealTime = 0;
    applyReveal();
    needsRender = true;
  });
  primary.addEventListener("input", applyColors);
  accent.addEventListener("input", applyColors);
  for (const button of moodButtons) {
    button.addEventListener("click", () => {
      setMood(readMood(button.dataset.mood ?? null));
      url.searchParams.set("mood", mood);
      history.replaceState(null, "", url);
    });
  }
  const markCameraInput = () => { lastCameraMove = performance.now(); };
  canvas.addEventListener("pointerdown", markCameraInput);
  canvas.addEventListener("pointermove", (event) => { if (event.buttons) markCameraInput(); });
  canvas.addEventListener("keydown", markCameraInput);

  engine.runRenderLoop(() => {
    if (document.hidden) return;
    const revealing = revealTime < duration;
    if (!playing && !revealing && !needsRender && !voice.needsFrame() && performance.now() - lastCameraMove > 500) return;
    const frameSeconds = engine.getDeltaTime() / 1000;
    const dt = Math.min(frameSeconds, 0.05);
    if (revealing) {
      revealTime = Math.min(duration, revealTime + Math.min(frameSeconds, 0.1));
      applyReveal();
    }
    if (playing) {
      // Clamp the first frame after a suspended tab so the effect doesn't jump forward.
      time += dt;
      flowTime += dt * speed.valueAsNumber;
    }
    portrait.rotation.y = 0.047 * Math.sin(time * 0.53);
    portrait.rotation.z = 0.018 * Math.sin(time * 0.71);
    portrait.position.y = 0.039 * Math.sin(time * 0.86);
    const speech = voice.tick(dt);
    face.setSpeech(speech.open, speech.wide, voice.isSpeaking());
    face.update(time, 1);
    energy.update(flowTime, 1);
    scene.render();
    needsRender = false;
  });
}

start().catch((error: unknown) => {
  console.error(error);
  status.textContent = "The 3D portrait couldn’t load. Try reloading or open the Canvas 2D version.";
});
