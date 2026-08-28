# CodeFallFace 3.0 Design

**Date:** 2026-08-20  
**Status:** Approved direction  
**Chosen approach:** Deep-module evolution behind the existing `CodefallFace` facade

## Executive Summary

CodeFallFace already has a distinctive visual identity and a useful embedding API. Version 3.0 should not replace that foundation. It should deepen it: preserve the zero-build browser demo and existing public methods while separating the runtime, rendering, provider, networking, and UI responsibilities that currently accumulate in a few large files.

The result will be a more convincing borrowed cybernetic face, a more reliable agent surface, and a product-quality demo/control deck. The browser artifact remains plain HTML, CSS, Canvas 2D, and JavaScript modules with no runtime dependencies. Development tooling may use Node's test runner and Playwright, but no framework or build step becomes necessary to run or embed the face.

## Current-State Audit

### What is already strong

- `CodefallFace` is a recognizable public facade with speech, listening, emotion, interruption, theme, geometry, provider, and agent-socket controls.
- The procedural face model is based on scalar fields and typed buffers, which is a strong fit for real-time deformation and low-allocation rendering.
- The glyph atlas avoids per-cell `fillText` calls and supports distinct material vocabularies.
- Wintermute and Codefall themes share one model while retaining different visual identities.
- Possession events are bounded, localized, and disabled by reduced-motion mode.
- Voice providers already share an event-oriented base contract.
- The static demo works without credentials or a frontend toolchain.
- The existing automated suite has 44 passing tests and strong coverage of geometry, glyph selection, configuration, and possession timing.

### Measured concentration and risk

| Area | Current evidence | Consequence |
|---|---:|---|
| Renderer | `src/face/renderer.js` is 643 lines; measured line coverage is 19.44% | Grid ownership, animation scheduling, rain, glyph churn, debris, possession, glow, halo, quality, and FPS accounting change together |
| Controller | `src/codefall-face.js` is 403 lines | Public API, state transitions, gaze, provider selection, RAF lifecycle, and agent networking share one owner |
| UI shell | `src/main.js` is 266 lines | DOM rendering, transcript policy, docking, controls, preferences, and debug output are difficult to test independently |
| Backend | `server/server.mjs` is 334 lines | Static hosting, Azure relay, Lacy proxy, Piper, and the agent hub share parsing, limits, logging, and error paths |
| Voice | Azure is 296 lines, local speech is 175 lines, and voice modules have little direct test coverage | Provider switching, teardown, retries, and event ordering are regression-prone |
| Speech dynamics | `speech-engine.js` has 31.71% measured line coverage | Mouth behavior is important but is mostly verified indirectly |
| Quality selection | Auto quality returns `high` for both DPR branches on non-small screens | The feature is nominally adaptive but does not react to sustained frame pressure |

### Specific lifecycle and product gaps

- `destroy()` stops RAF and the active adapter but does not define a terminal state, clear every reconnect/interrupt timer, or guarantee that agent networking cannot reconnect afterward.
- Provider switching lacks an operation generation or abort boundary, so overlapping initialization can publish stale results.
- Adapter event subscriptions are wired as anonymous listeners, making explicit unwiring difficult.
- Agent socket reconnection is embedded in `CodefallFace`, has a fixed delay, and has no message-size/schema boundary.
- `document.body.dataset` exposes demo state globally; multiple embedded faces can overwrite each other's theme/geometry state.
- Randomness is read directly from `Math.random`, preventing deterministic animation and browser regression scenarios.
- The page disables user zoom with `user-scalable=no`, which is an accessibility defect.
- UI controls have partial ARIA state but no consolidated capability model, keyboard command layer, or recoverable provider status.
- Tests validate pure helpers well but do not exercise complete controller lifecycle, provider failover, the main render loop, server boundaries, or browser behavior.

## Product Goals

### 1. Visual depth

The face should remain human-readable at all times while feeling assembled from a machine substrate rather than painted with random glyphs.

- Strengthen forehead planes, orbital depth, cheekbones, nose bridge, lips, jaw hinges, chin, ears/temple ports, and neck attachment.
- Render three intelligible layers: borrowed skin tiles, structural seams/actuators, and the machine substrate beneath.
- Give speech more than vertical mouth opening: width, tension, lip compression, asymmetric timing, and a stable dark oral cavity.
- Introduce a controlled visual-event grammar rather than unrelated random glitches.
- Preserve the chiseled/smooth toggle and both existing themes.
- Keep stable states calm enough that rare breaches feel meaningful.

### 2. Architectural reliability

- Keep `CodefallFace` as the compatibility facade.
- Give temporal state, rendering, quality, providers, and agent networking one clear owner each.
- Make every long-lived resource cancellable and idempotently disposable.
- Make runtime behavior deterministic when supplied a seed and controllable clock.
- Test through module interfaces rather than exporting implementation fragments solely for tests.
- Avoid hypothetical interfaces: Canvas 2D remains the only renderer until a second renderer exists.

### 3. Product polish

- Make current provider, capabilities, listening state, quality, motion policy, and failures legible.
- Add user controls for visual intensity, quality policy, motion, and face profile without turning the interface into a graphics editor.
- Preserve a face-first presentation on desktop and mobile.
- Support keyboard operation, visible focus, zoom, screen-reader state, and reduced motion.
- Provide a diagnostic snapshot useful to integrators without requiring the debug DOM.

## Non-Goals

- No React, Vue, Svelte, bundler, transpiler, or required build step.
- No WebGL/WebGPU renderer in this milestone.
- No photorealistic 3D mesh, camera tracking, or facial-recognition input.
- No breaking rename or removal of current public methods/events.
- No credentials in browser code or Git-tracked configuration.
- No expansion of Lacy beyond the capabilities its actual service exposes.
- No unbounded particle systems, per-cell object creation, or per-frame canvas allocation.

## Global Constraints

- The browser application MUST remain directly servable from static files.
- Browser runtime dependencies MUST remain zero.
- Existing `CodefallFace` constructor arguments, methods, and events MUST remain compatible.
- Canvas 2D MUST remain the production renderer for this milestone.
- Per-cell loops MUST NOT allocate arrays, objects, closures, strings, or canvases.
- Reduced-motion mode MUST disable displacement, flashing, rapid duplication, animated debris, and automatic camera-like motion.
- Existing `wintermute` and `codefall` themes and `chiseled`/`smooth` geometry values MUST remain valid.
- Secrets MUST remain server-side.
- Node server support MUST remain Node.js 20 or newer.
- Playwright 1.61.0 MAY be added as a development-only dependency for browser verification.

## Proposed Architecture

```text
Embedder / control deck / agent
             |
      CodefallFace facade
             |
      +------+------------------+
      |                         |
 FaceRuntime              ProviderManager
 state + clock            provider lifecycle
 gaze + emotion           capabilities + recovery
 speech dynamics                 |
 visual event scheduler      VoiceAdapter(s)
      |
 reusable FrameState
      |
 CodefallRenderer ---------- QualityController
 buffers + atlas             measured frame policy
 render passes

 AgentChannel <-----------> CodefallFace events/commands
```

### Compatibility facade: `CodefallFace`

`CodefallFace` remains the only public composition root. It validates the container, resolves configuration, creates internal modules, forwards commands, translates internal events into the existing event contract, and owns final disposal.

It MUST no longer calculate gaze, emotion interpolation, coherence, or speech dynamics itself. It MUST not implement provider-selection loops or WebSocket reconnection.

Existing methods remain:

```javascript
speak(text, emotion?, opts?)
ask(text)
setEmotion(name)
startListening()
stopListening()
interrupt()
setMuted(muted)
setTheme(name)
setGeometry(style)
toggleGeometry()
setProvider(name)
attachAgentSocket(url, options?)
detachAgentSocket()
on(type, callback)
destroy()
```

Additive methods:

```javascript
pause()
resume()
setQuality(policy)          // auto | high | medium | low
setVisualIntensity(value)  // 0..1
getSnapshot()              // serializable runtime/capability/performance state
```

`on(type, callback)` will return an unsubscribe function while retaining current behavior for callers that ignore the return value.

### `FaceRuntime`: temporal state owner

Create `src/runtime/face-runtime.js`. This is a deep module that turns commands and elapsed time into one reusable frame state.

Responsibilities:

- lifecycle state and legal transitions;
- coherence and boot assembly;
- emotion target and interpolation;
- gaze targets, saccades, and blink schedule;
- speech-engine sampling;
- interruption recovery;
- seeded visual-event scheduling;
- pause/resume and hidden-document behavior.

Interface:

```javascript
const runtime = new FaceRuntime({ config, speech, random, now });
runtime.command({ type: 'emotion', value: 'anger' });
runtime.command({ type: 'provider-state', value: 'speaking' });
const frame = runtime.tick(dt); // same preallocated object each frame
runtime.getSnapshot();
runtime.destroy();
```

The runtime state machine supports:

```text
booting -> idle
idle <-> listening
idle/listening -> thinking -> speaking -> idle
speaking/listening/thinking -> interrupted -> idle
any live state -> error -> idle (recoverable) or destroyed
any live state <-> paused
```

Illegal transitions are ignored with a diagnostic event rather than corrupting state.

### Deterministic random and clock inputs

Create `src/runtime/random.js` with a small seeded generator and allow injection of `random()` and `now()` functions. Production defaults use a generated seed and `performance.now`; tests and demos provide explicit seeds.

Random streams are separated by purpose (`gaze`, `blink`, `rain`, `debris`, `events`) so adding one effect does not silently change all others.

### Visual-event grammar

Replace scattered random special cases with `src/face/visual-events.js`. It schedules four event families:

| Event | Typical cadence | Duration | Visual intent |
|---|---:|---:|---|
| seam crawl | 3–8 s | 0.4–1.2 s | a cold signal travels along structural seams |
| ocular desync | 8–20 s | 80–220 ms | one borrowed eye briefly loses phase |
| mask slip | 12–30 s | 180–500 ms | facial tiles shear while anatomy stays anchored |
| aperture breach | 18–45 s | 250–650 ms | machinery opens beneath cheek, temple, or jaw |

Only one medium/major event may be active at once. A configurable intensity scales cadence and displacement, not accessibility limits. Reduced motion converts events into static seam emphasis or suppresses them.

### Face model evolution

Keep `FaceModel` as the topology module and retain scalar `headHalfWidth` and `smoothHeadDistance` paths.

Add explicit scalar fields for:

- brow ridge and glabella;
- orbital sockets distinct from luminous eyes;
- nose bridge, side planes, nostril shadow, and tip plate;
- zygomatic/cheek planes and nasolabial seam;
- upper/lower lips, oral cavity, and jaw hinge;
- temple port, ear suggestion, chin plate, and neck tendons;
- substrate exposure mask separate from visible brightness.

The model fills preallocated buffers:

```javascript
model.fill({
  brightness,
  region,
  material,
  distance,
  depth,
  substrate,
}, expression, frame);
```

`depth` is a normalized pseudo-depth field used for lighting and tile scale. `substrate` records where machinery can be revealed without recomputing anatomy in render passes.

### Rendering system

Keep `CodefallRenderer` as one deep external module, with internal collaborators that are not exposed to callers:

- `src/face/scene-buffers.js`: typed-array allocation, resize, and buffer reuse;
- `src/face/render-passes.js`: ordered Canvas 2D passes;
- `src/face/quality-controller.js`: quality selection and hysteresis;
- existing `glyphs.js`: atlas vocabulary and theme tokens.

Pass order:

1. background fade or reduced-motion clear;
2. signal rain;
3. borrowed-skin tiles and facial seams;
4. substrate/machine exposure;
5. disintegration and bounded debris;
6. eyes and speech cavity highlights;
7. halo and breach interruption;
8. CRT/noise finishing that cannot obscure anatomy.

The renderer receives a frame state and renders it. It does not decide emotions, blink timing, or lifecycle state.

### Adaptive quality

`QualityController` owns the policy and reports changes through a `quality` event.

- Explicit `high`, `medium`, or `low` never changes automatically.
- `auto` starts from viewport/device hints.
- Frame time is sampled over 120 rendered frames.
- Step down one tier after two consecutive windows averaging slower than 20.8 ms (below 48 FPS).
- Step up one tier after four consecutive windows averaging faster than 17.2 ms (above 58 FPS).
- Changes have an eight-second cooldown.
- Hidden time, resize frames, and provider initialization are excluded.

Performance acceptance targets:

- Desktop high: at least 55 average FPS during a 30-second scripted scene.
- Mobile medium: at least 45 average FPS during the same scene.
- Low tier: no more than 36 live debris particles.
- No per-cell allocations in model or glyph render loops.
- Resize allocates one new buffer set, then returns to a steady allocation profile.

### Provider lifecycle

Create `src/voice/provider-manager.js` as the sole owner of adapter creation, selection, fallback, switching, capabilities, and disposal.

```javascript
const manager = new ProviderManager({ config, factories });
await manager.start('auto');
await manager.switchTo('piper');
manager.getSnapshot();
manager.destroy();
```

Each start/switch operation gets a monotonically increasing generation. Results from stale generations are destroyed and never published. Manager events are normalized to `provider`, `capabilities`, `statechange`, `transcript`, `audio`, and `error`.

Provider failures are classified:

- unavailable: try the next configured provider;
- recoverable: remain selected and expose retry;
- fatal: dispose and enter fallback selection;
- user-denied: do not retry automatically.

Adapters keep their current public base contract but MUST make `destroy()` idempotent and clear all timers, media tracks, audio nodes, callbacks, and sockets.

### Agent channel

Create `src/agent/agent-channel.js` to own URL normalization, command parsing, reconnect policy, event forwarding, and disposal.

- Validate command type and required scalar/string fields before dispatch.
- Reject messages over 64 KiB.
- Use exponential backoff with jitter: 1 s, 2 s, 4 s, 8 s, then 15 s maximum.
- Reset backoff after a stable connection.
- Never reconnect after explicit detach or face destruction.
- Queue only the latest state snapshot while disconnected; do not buffer speech commands.

### Server decomposition and hardening

Keep `server/server.mjs` as the composition root and extract deep handlers:

```text
server/lib/http-utils.mjs      bounded JSON reads, responses, headers
server/lib/static-handler.mjs safe static file resolution and cache policy
server/lib/azure-relay.mjs    authenticated upstream relay lifecycle
server/lib/lacy-handler.mjs   health and bounded reply proxy
server/lib/piper-handler.mjs  local TTS process lifecycle
server/lib/face-hub.mjs       authenticated commands, events, sockets
```

Server requirements:

- 64 KiB JSON request limit and 1 MiB WebSocket message limit;
- configurable allowed origins, defaulting to same-origin/localhost;
- `X-Content-Type-Options`, `Referrer-Policy`, and a CSP compatible with the static app;
- structured one-line logs with request/connection IDs;
- `/healthz` reporting process health and provider availability without secrets;
- graceful shutdown that stops accepting work, closes sockets, and terminates Piper children;
- no path traversal or serving of dotfiles, `.env`, keys, model files, or source maps by accident.

### Control deck and embedding UX

Split `src/main.js` into a small bootstrap and `src/ui/control-deck.js`. The control deck consumes only the public `CodefallFace` API.

Product changes:

- provider/capability status with a retry action;
- visual intensity control with Calm, Standard, and Breach presets;
- Auto/High/Medium/Low quality control;
- motion policy control that clearly distinguishes system preference and explicit override;
- current theme, geometry, emotion, listening, mute, and provider reflected with `aria-pressed`/`aria-selected`;
- diagnostic snapshot copy action;
- versioned preferences in local storage, limited to presentation settings;
- compact mobile layout and draggable desktop console retained.

Accessibility requirements:

- remove `user-scalable=no`;
- visible `:focus-visible` treatment for every interactive element;
- all icon buttons have stable accessible names and state;
- canvas has a concise static description while changing state is announced in a separate polite live region;
- transcript roles are represented semantically and do not repeatedly announce partial tokens;
- all operations are keyboard reachable without drag gestures;
- color is never the only indication of listening, failure, selection, or mute;
- reduced-motion mode is testable and visually coherent, not merely frozen mid-effect.

## Configuration Model

`resolveConfig` remains the entry point but validates and normalizes known values. Unknown keys are preserved only under `extensions`; invalid core values fall back and emit diagnostics.

New configuration:

```javascript
face: {
  theme: 'wintermute',
  geometry: 'chiseled',
  quality: 'auto',
  reducedMotion: 'auto',
  visualIntensity: 0.65,
  seed: null,
  bootDuration: 4,
},
agent: {
  reconnect: true,
  maxMessageBytes: 65536,
},
diagnostics: {
  enabled: false,
  sampleFrames: 120,
}
```

## Events and Diagnostics

Existing events remain unchanged. Add:

```javascript
'capabilities' { tts, stt, conversational, waveform, retry }
'quality'      { policy, tier, reason }
'visualevent'  { type, phase, intensity }
'diagnostic'   { code, level, message }
'snapshot'     getSnapshot() result after material state changes
```

`getSnapshot()` returns JSON-safe data only:

```javascript
{
  lifecycle: 'idle',
  provider: { name: 'local', capabilities: { /* booleans */ } },
  face: { theme: 'wintermute', geometry: 'chiseled', emotion: 'neutral', coherence: 1 },
  rendering: { policy: 'auto', tier: 'high', fps: 60, reducedMotion: false },
  connection: { agent: 'disconnected' },
}
```

## Test Strategy

### Unit tests

- State-machine transition table, pause/resume, boot completion, and interrupted recovery.
- Seeded random stream independence and deterministic visual-event scheduling.
- Face-runtime output for gaze, blink, emotion, coherence, and speech inputs.
- Scene-buffer allocation/reuse and quality hysteresis.
- Face-model anatomy, material, depth, substrate, and both geometries.
- Provider-manager fallback, stale-generation disposal, capability publication, and idempotent destroy.
- Agent-channel validation, backoff, detach, and no-reconnect-after-destroy.
- Bounded server body parsing, safe static paths, auth, origin checks, graceful shutdown, and provider health.

### Browser tests

Use Playwright 1.61.0 as a development-only dependency with a local static server. Cover Chromium desktop, WebKit desktop, a mobile WebKit profile, and a reduced-motion project.

- Page boots without console errors and reaches idle.
- TALK, LISTEN capability handling, INTERRUPT, MUTE, theme, geometry, emotion, quality, and visual-intensity controls expose correct state.
- Chiseled/smooth and Codefall/Wintermute screenshot baselines remain recognizable.
- Speech creates a dark mouth cavity and visible articulation.
- A seeded breach exposes machinery without displacing the whole face.
- Mobile has no horizontal overflow and all controls meet the 44 px target.
- Zoom is not disabled.
- Reduced motion contains no displaced bands, debris animation, or rapid halo changes.
- Destroying an embedded face removes canvas, listeners, timers, provider resources, and reconnection attempts.

### Performance verification

A deterministic 30-second scene records frame time, tier changes, particle peak, resize allocations, and long frames. CI enforces structural invariants and broad thresholds; real-device measurements are recorded manually because virtualized CI FPS is not representative.

## Rollout Strategy

1. Establish deterministic runtime and lifecycle tests without changing visuals.
2. Move provider and agent lifecycles behind managers.
3. Split renderer storage/passes and add measured quality control.
4. Extend anatomy and substrate buffers behind current themes.
5. Add visual-event grammar and richer articulation.
6. Rebuild the control deck on the stable public facade.
7. Decompose and harden the server.
8. Add browser, accessibility, visual, and performance gates.

Every phase must leave the static demo usable and the existing API passing. No long-lived parallel implementation is allowed; each extracted responsibility replaces its old code in the same phase.

## Success Criteria

- Existing public API examples continue to work without changes.
- Static hosting still requires only serving the repository root.
- All current 44 tests remain green, with new lifecycle/render/provider/server/browser tests added.
- Renderer, runtime, provider manager, agent channel, and server handler interfaces each have direct behavioral tests.
- The default face reads as human in neutral, speech, strong emotion, low coherence, and possession states at desktop and mobile sizes.
- Chiseled/smooth and Wintermute/Codefall combinations retain the same controls, animation inputs, and substrate system.
- Provider switching cannot publish a stale adapter and destruction leaves no active timers, sockets, media tracks, or RAF callbacks.
- Auto quality demonstrably steps down and back up under deterministic frame-time tests without oscillation.
- Keyboard, zoom, focus, reduced motion, and live state meet the accessibility requirements above.
- The deployed demo has no uncaught console errors in Chromium or WebKit smoke tests.

## Rejected Alternatives

### Continue adding behavior directly to existing large classes

This minimizes file churn but makes every future visual or provider improvement riskier. The renderer and controller already own too many policies, and their low integration coverage makes incremental accumulation deceptive rather than safe.

### Replace Canvas 2D with WebGL/WebGPU now

This raises the visual ceiling but introduces shader/tooling/browser complexity before lifecycle and state ownership are trustworthy. The proposed buffer and runtime seams keep that option open without paying for a hypothetical second renderer today.

### Adopt a frontend framework

The control deck is not complex enough to justify a runtime framework, and doing so would weaken the project's strongest integration property: import a module or serve static files directly.
