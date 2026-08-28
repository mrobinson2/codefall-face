# CodeFallFace 3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve CodeFallFace into a richer cybernetic face, a reliable agent runtime, and a polished accessible product without breaking its static deployment or public API.

**Architecture:** Keep `CodefallFace` as the compatibility facade. Move temporal behavior into `FaceRuntime`, provider selection into `ProviderManager`, agent networking into `AgentChannel`, render storage/passes into deeper renderer internals, and DOM behavior into `ControlDeck`; retain Canvas 2D and typed-array scalar geometry.

**Tech Stack:** Browser JavaScript modules, Canvas 2D, Web Audio/Web Speech, Node.js 20+, Node test runner, `ws` 8.x on the optional server, Playwright 1.61.0 as development-only browser tooling.

**Spec:** `docs/superpowers/specs/2026-08-20-codefall-face-3-design.md`

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

---

## Task 1: Establish deterministic test infrastructure and baseline gates

**Files:**
- Modify: `package.json`
- Create: `test/helpers/fake-clock.js`
- Create: `test/helpers/fake-random.js`
- Create: `test/helpers/fake-platform.js`
- Create: `test/baseline-contract.test.js`

**Purpose:** Give later runtime, lifecycle, and networking work controllable time, randomness, animation frames, visibility, media preferences, and socket behavior without a DOM framework.

### Interface

```javascript
export class FakeClock {
  now = 0;
  requestAnimationFrame(callback) {}
  cancelAnimationFrame(id) {}
  setTimeout(callback, delay) {}
  clearTimeout(id) {}
  advance(milliseconds) {}
  pending() {}
}

export function sequenceRandom(values, fallback = 0.5) {}
export function seededRandom(seed) {}

export function createFakePlatform(options = {}) {
  return {
    clock,
    document,
    window,
    createCanvas,
    createWebSocket,
    matchMedia,
    setHidden,
    dispatchResize,
  };
}
```

- [ ] **Step 1: Add the baseline contract test**

Create `test/baseline-contract.test.js` with assertions that the current exports and method names exist before refactoring:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { CodefallFace } from '../src/codefall-face.js';

test('CodefallFace keeps the v2 compatibility surface', () => {
  for (const name of [
    'speak', 'ask', 'setEmotion', 'startListening', 'stopListening',
    'interrupt', 'setMuted', 'setTheme', 'setGeometry', 'toggleGeometry',
    'setProvider', 'attachAgentSocket', 'detachAgentSocket', 'on', 'destroy',
  ]) assert.equal(typeof CodefallFace.prototype[name], 'function', name);
});
```

- [ ] **Step 2: Run the baseline contract test**

Run: `rtk node --test test/baseline-contract.test.js`

Expected: one passing test.

- [ ] **Step 3: Implement the clock and random helpers**

`FakeClock.advance(ms)` MUST execute timers in due-time/insertion order, then execute each queued RAF callback once with the final clock time. Timer callbacks scheduled during an advance and due before the target time MUST also run. `pending()` returns `{ timers, animationFrames }`.

`sequenceRandom` MUST consume values in order and then return the fallback. `seededRandom` MUST produce a deterministic `0 <= value < 1` sequence from an unsigned 32-bit seed.

- [ ] **Step 4: Implement the browser-platform fake**

The fake MUST support:

- event listener registration/removal counts for `window` and `document`;
- `document.hidden` changes;
- a canvas with a recording 2D context implementing every method the renderer calls;
- `getBoundingClientRect()` with configurable width/height;
- `matchMedia('(prefers-reduced-motion: reduce)')`;
- a WebSocket fake with `CONNECTING`, `OPEN`, `CLOSING`, `CLOSED` states;
- inspectable sent messages and explicit `open()`, `message()`, `close()`, and `error()` controls.

- [ ] **Step 5: Add test scripts without changing the default test contract**

Update root `package.json`:

```json
{
  "scripts": {
    "test": "node --test test/*.test.js",
    "test:unit": "node --test test/*.test.js",
    "test:coverage": "node --test --experimental-test-coverage test/*.test.js"
  }
}
```

- [ ] **Step 6: Verify helpers and existing suite**

Run:

```bash
rtk node --test test/baseline-contract.test.js
rtk npm test
```

Expected: helper/contract tests pass and all pre-existing 44 tests remain green.

- [ ] **Step 7: Commit**

```bash
rtk git add package.json test/helpers test/baseline-contract.test.js
rtk git commit -m "test: add deterministic runtime harness"
```

---

## Task 2: Add the runtime state machine and independent random streams

**Files:**
- Create: `src/runtime/random.js`
- Create: `src/runtime/state-machine.js`
- Create: `test/random.test.js`
- Create: `test/state-machine.test.js`

**Purpose:** Make legal state transitions and random behavior explicit before moving animation policy out of `CodefallFace`.

### Interface

```javascript
export function createRandomStreams(seed, names = [
  'gaze', 'blink', 'rain', 'debris', 'events',
]) {}

export const FACE_STATES = Object.freeze([
  'booting', 'idle', 'listening', 'thinking', 'speaking',
  'interrupted', 'error', 'paused', 'destroyed',
]);

export class FaceStateMachine extends EventTarget {
  constructor(initial = 'booting') {}
  transition(next, detail = {}) {}
  pause() {}
  resume() {}
  destroy() {}
  get snapshot() {}
}
```

- [ ] **Step 1: Write failing random-stream tests**

Cover:

```javascript
test('equal seeds produce equal named streams', () => {});
test('consuming gaze does not move the events stream', () => {});
test('unknown stream names are rejected', () => {});
```

The second test creates two stream sets from the same seed, consumes ten values from `a.gaze`, and asserts `a.events()` still equals the first value from `b.events()`.

- [ ] **Step 2: Run random tests and confirm failure**

Run: `rtk node --test test/random.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement named deterministic streams**

Derive each stream seed by hashing the root seed with the stream name using 32-bit integer operations. Never share generator state between names. Freeze the returned name map.

- [ ] **Step 4: Write failing state-machine tests**

Cover the full transition table:

```javascript
test('booting reaches idle but cannot jump to interrupted', () => {});
test('conversation states follow idle-listening-thinking-speaking-idle', () => {});
test('interrupt recovers to the previous live baseline', () => {});
test('pause remembers and restores the prior live state', () => {});
test('destroy is terminal and idempotent', () => {});
test('invalid transitions emit one diagnostic without changing state', () => {});
```

- [ ] **Step 5: Run state-machine tests and confirm failure**

Run: `rtk node --test test/state-machine.test.js`

Expected: module-not-found failure.

- [ ] **Step 6: Implement the transition table**

Use a frozen map of allowed destination states. `transition()` returns `true` only when the state changes. Emit `change` with `{ previous, state, detail }`; emit `diagnostic` with code `invalid-transition` otherwise. `destroy()` clears the remembered paused/interrupted state.

- [ ] **Step 7: Run focused and full tests**

```bash
rtk node --test test/random.test.js test/state-machine.test.js
rtk npm test
```

- [ ] **Step 8: Commit**

```bash
rtk git add src/runtime test/random.test.js test/state-machine.test.js
rtk git commit -m "feat: add deterministic face state runtime primitives"
```

---

## Task 3: Move temporal animation into `FaceRuntime`

**Files:**
- Create: `src/runtime/gaze-controller.js`
- Create: `src/runtime/visual-event-scheduler.js`
- Create: `src/runtime/face-runtime.js`
- Create: `test/gaze-controller.test.js`
- Create: `test/visual-event-scheduler.test.js`
- Create: `test/face-runtime.test.js`
- Modify: `src/face/possession.js`
- Modify: `src/speech/speech-engine.js`

**Purpose:** Give coherence, emotion, gaze, blink, speech dynamics, and visual-event cadence one deterministic owner.

### Frame contract

`FaceRuntime.tick(dt)` MUST return the same object identity on every call:

```javascript
{
  mode: 'idle',
  params: NEUTRAL,
  dyn: {
    t: 0,
    coherence: 0,
    gazeX: 0,
    gazeY: 0,
    blink: 1,
    mouthOpen: 0,
    mouthWide: 0,
    tension: 0,
    energy: 0,
    swayX: 0,
    swayY: 0,
  },
  visualEvent: {
    type: 'none', phase: 'idle', envelope: 0,
    bands: [], aperture: null, haloDrop: 0,
  },
}
```

- [ ] **Step 1: Write failing gaze tests**

Test idle target bounds, thinking target bounds, listening focus, exponential movement toward targets, blink close/open timing, and reduced-motion suppression.

- [ ] **Step 2: Implement `GazeController`**

`tick(dt, mode, reducedMotion)` mutates and returns one preallocated result. Accept injected `gazeRandom` and `blinkRandom`. Do not call `Math.random` internally.

- [ ] **Step 3: Write failing visual-event scheduler tests**

Cover deterministic cadence, one medium/major event at a time, the four event families, maximum 650 ms breach duration, intensity scaling, and reduced-motion conversion/suppression.

- [ ] **Step 4: Implement the visual-event scheduler**

Reuse the current `PossessionController` band clamping and envelope behavior for `mask-slip`/`aperture-breach`. Preallocate a maximum of three band records and mutate them rather than creating new band arrays per event.

- [ ] **Step 5: Write failing `FaceRuntime` tests**

Cover:

```javascript
test('tick reuses one frame object and nested dynamics object', () => {});
test('boot reaches idle after configured coherence assembly', () => {});
test('emotion parameters converge without overshoot', () => {});
test('provider speech state drives actual speech-engine dynamics', () => {});
test('interrupt lowers coherence then returns to idle', () => {});
test('pause freezes time and resume avoids a delta spike', () => {});
test('destroy stops commands and returns a destroyed snapshot', () => {});
```

- [ ] **Step 6: Implement `FaceRuntime`**

Move the corresponding calculations from `CodefallFace._loop` and `CodefallRenderer.render` without changing constants in the first pass. Accept `{ config, speech, streams }`. Runtime commands are plain objects with types `emotion`, `provider-state`, `interrupt`, `coherence`, `reduced-motion`, `pause`, and `resume`.

- [ ] **Step 7: Add direct `SpeechEngine` coverage**

Test waveform analysis with a fake analyser, text pulse decay, fake pulse, speaking/idle convergence, and idempotent analyser replacement. Keep the engine allocation-free in `tick`.

- [ ] **Step 8: Run focused and full tests**

```bash
rtk node --test test/gaze-controller.test.js test/visual-event-scheduler.test.js test/face-runtime.test.js
rtk npm test
```

- [ ] **Step 9: Commit**

```bash
rtk git add src/runtime src/face/possession.js src/speech/speech-engine.js test/gaze-controller.test.js test/visual-event-scheduler.test.js test/face-runtime.test.js
rtk git commit -m "feat: centralize deterministic face runtime"
```

---

## Task 4: Integrate the runtime behind the compatibility facade

**Files:**
- Modify: `src/codefall-face.js`
- Create: `src/platform/browser-platform.js`
- Modify: `test/codefall-face.test.js`
- Create: `test/codefall-face-lifecycle.test.js`
- Modify: `README.md`

**Purpose:** Make the facade thin and ensure complete, idempotent lifecycle ownership without changing existing consumers.

### Construction and lifecycle

```javascript
new CodefallFace(container, userConfig, {
  platform,       // internal/test seam; browser default
  randomSeed,
  providerFactories,
});
```

The third argument is additive and documented as an advanced testing seam, not required for normal embedding.

- [ ] **Step 1: Write failing lifecycle tests**

Cover:

```javascript
test('constructor owns one RAF and one resize listener', () => {});
test('hidden documents pause runtime work without accumulating delta', () => {});
test('pause and resume preserve the last live state', () => {});
test('on returns an unsubscribe function', () => {});
test('destroy removes canvas listeners RAF timers sockets and adapter', () => {});
test('destroy is safe before provider readiness and safe twice', () => {});
test('commands after destroy reject with a destroyed error', () => {});
```

- [ ] **Step 2: Run lifecycle tests and confirm failure**

Run: `rtk node --test test/codefall-face-lifecycle.test.js`

- [ ] **Step 3: Implement `BrowserPlatform`**

Wrap `window`, `document`, RAF, timeouts, `performance.now`, `matchMedia`, canvas creation, and WebSocket creation. Production code reads browser globals only in this module and UI bootstrap files.

- [ ] **Step 4: Replace controller calculations with runtime calls**

`CodefallFace._loop(now)` MUST:

1. schedule the next frame only when live;
2. calculate and clamp `dt` through the platform clock;
3. call `runtime.tick(dt)`;
4. call `renderer.render(dt, frame)`;
5. mirror material state into public fields/events only when changed.

Delete gaze, coherence interpolation, emotion blending, and speech dynamic assembly from the facade after equivalence tests pass.

- [ ] **Step 5: Add the additive public methods**

Implement `pause`, `resume`, `setQuality`, `setVisualIntensity`, and `getSnapshot`. Invalid quality/intensity input MUST leave state unchanged and emit a diagnostic; intensity is clamped only after numeric validation.

- [ ] **Step 6: Make container state instance-safe**

Write theme, geometry, and lifecycle datasets to `container.dataset`. Continue mirroring the demo's primary instance to `document.body.dataset` only when `container.id === 'stage'` so existing CSS remains compatible without cross-instance interference.

- [ ] **Step 7: Run compatibility and lifecycle tests**

```bash
rtk node --test test/baseline-contract.test.js test/codefall-face.test.js test/codefall-face-lifecycle.test.js
rtk npm test
```

- [ ] **Step 8: Update the embedding API documentation**

Document the five additive methods, the unsubscribe return from `on`, deterministic seed configuration, and the guarantee that `destroy()` is terminal/idempotent.

- [ ] **Step 9: Commit**

```bash
rtk git add src/codefall-face.js src/platform test/codefall-face.test.js test/codefall-face-lifecycle.test.js README.md
rtk git commit -m "refactor: deepen CodefallFace runtime boundary"
```

---

## Task 5: Add a race-safe provider manager and harden adapter disposal

**Files:**
- Create: `src/voice/provider-manager.js`
- Modify: `src/voice/adapter.js`
- Modify: `src/voice/azure-voice-live.js`
- Modify: `src/voice/local-speech.js`
- Modify: `src/voice/lacy.js`
- Modify: `src/voice/piper.js`
- Modify: `src/voice/voice-fx.js`
- Modify: `src/codefall-face.js`
- Create: `test/provider-manager.test.js`
- Create: `test/voice-adapters.test.js`

### Manager contract

```javascript
export class ProviderManager extends EventTarget {
  constructor({ config, factories }) {}
  start(name = 'auto') {}
  switchTo(name) {}
  retry() {}
  getSnapshot() {}
  destroy() {}
}
```

- [ ] **Step 1: Write provider-manager race/fallback tests**

Use fake adapters with externally resolvable `init()` promises. Cover auto order `azure -> piper -> local`, explicit-provider fatal failure, recoverable retry, user-denied no-retry, capability events, stale init disposal, active adapter replacement, and manager destruction during init.

- [ ] **Step 2: Run tests and confirm failure**

Run: `rtk node --test test/provider-manager.test.js`

- [ ] **Step 3: Implement generation-safe provider selection**

Every `start`/`switchTo` increments `this.generation`. After each awaited init, compare the captured generation. A stale adapter MUST be destroyed and ignored. Destroy the prior active adapter only after the next adapter is viable, except when the user explicitly requests shutdown.

- [ ] **Step 4: Normalize provider snapshots and errors**

Snapshot fields:

```javascript
{
  status: 'idle|starting|ready|recoverable-error|fatal-error|destroyed',
  name: 'azure|piper|lacy|local|silent',
  capabilities: { tts, stt, conversational, waveform, retry },
  error: null,
}
```

Normalize failures to `{ kind, provider, message, cause }` where `kind` is `unavailable`, `recoverable`, `fatal`, or `user-denied`.

- [ ] **Step 5: Write adapter disposal tests**

For each adapter, assert `destroy()` twice does not throw and leaves no active interval, timeout, media track, WebSocket, `SpeechSynthesisUtterance`, recognition callback, audio source, oscillator, or unresolved speech promise.

- [ ] **Step 6: Harden adapters and ghost FX**

Make `attachGhostFx` return `{ output, destroy }`; `destroy` disconnects nodes and stops the oscillator once. Give every adapter an internal disposer collection and clear it on destroy. Resolve interrupted speech promises exactly once.

- [ ] **Step 7: Replace `_initProvider`/`setProvider` in the facade**

`CodefallFace` forwards manager events into the existing `provider`, `state`, `transcript`, and `error` events plus the new `capabilities` event. Remove direct adapter class selection from the facade.

- [ ] **Step 8: Run focused and full tests**

```bash
rtk node --test test/provider-manager.test.js test/voice-adapters.test.js test/codefall-face-lifecycle.test.js
rtk npm test
```

- [ ] **Step 9: Commit**

```bash
rtk git add src/voice src/codefall-face.js test/provider-manager.test.js test/voice-adapters.test.js
rtk git commit -m "refactor: make provider lifecycle race safe"
```

---

## Task 6: Extract and secure the agent channel

**Files:**
- Create: `src/agent/agent-channel.js`
- Create: `src/agent/commands.js`
- Modify: `src/codefall-face.js`
- Create: `test/agent-channel.test.js`
- Modify: `docs/INTEGRATIONS.md`

### Command schema

`commands.js` exports `parseAgentCommand(raw, maxBytes = 65536)`. It returns `{ ok: true, command }` or `{ ok: false, code, message }` and accepts only:

```javascript
{ type: 'speak', text: string, emotion?: string }
{ type: 'ask', text: string }
{ type: 'emotion', emotion: string }
{ type: 'listen', on: boolean }
{ type: 'interrupt' }
{ type: 'mute', muted: boolean }
{ type: 'theme', theme: 'wintermute' | 'codefall' }
{ type: 'geometry', geometry: 'chiseled' | 'smooth' }
{ type: 'quality', quality: 'auto' | 'high' | 'medium' | 'low' }
{ type: 'visual-intensity', value: number }
```

- [ ] **Step 1: Write failing parser tests**

Cover valid commands, malformed JSON, arrays/null, unknown fields/types, missing required values, strings longer than 16 KiB, and raw messages over 64 KiB.

- [ ] **Step 2: Implement the pure parser**

Return stable diagnostic codes: `message-too-large`, `bad-json`, `bad-shape`, `unknown-command`, and `invalid-field`. Never echo the raw message in errors.

- [ ] **Step 3: Write failing channel tests**

Use fake clock/socket. Verify path URL normalization, hello snapshot, parsed command dispatch, event forwarding, 1/2/4/8/15-second backoff with bounded jitter, stable-connection reset, only-latest snapshot buffering, explicit detach, and no reconnect after destruction.

- [ ] **Step 4: Implement `AgentChannel`**

Interface:

```javascript
new AgentChannel({ platform, dispatchCommand, getSnapshot, random });
channel.attach(url, { reconnect: true });
channel.publish(type, detail);
channel.detach();
channel.destroy();
channel.getSnapshot();
```

- [ ] **Step 5: Delegate facade methods to the channel**

Remove socket/timer logic from `CodefallFace`. Forward existing transcript/state/emotion/error events through `channel.publish`. Include theme, geometry, quality, and capability changes in snapshot updates.

- [ ] **Step 6: Run tests**

```bash
rtk node --test test/agent-channel.test.js test/codefall-face-lifecycle.test.js
rtk npm test
```

- [ ] **Step 7: Update integration docs**

Document new commands, maximum sizes, reconnect behavior, and terminal detach/destroy semantics.

- [ ] **Step 8: Commit**

```bash
rtk git add src/agent src/codefall-face.js test/agent-channel.test.js docs/INTEGRATIONS.md
rtk git commit -m "refactor: isolate validated agent channel"
```

---

## Task 7: Deepen renderer storage and adaptive quality modules

**Files:**
- Create: `src/face/scene-buffers.js`
- Create: `src/face/quality-controller.js`
- Create: `test/scene-buffers.test.js`
- Create: `test/quality-controller.test.js`
- Modify: `src/face/renderer.js`
- Modify: `test/renderer-helpers.test.js`

### Scene buffers

```javascript
export class SceneBuffers {
  resize(cols, rows) {}
  clearFrame() {}
  get length() {}
  brightness;
  region;
  distance;
  material;
  depth;
  substrate;
  glyph;
  churnPhase;
}
```

- [ ] **Step 1: Write failing buffer reuse tests**

Assert equal-size resize reuses all typed-array identities, changed-size resize replaces them once, required array types are correct, frame clear touches only transient buffers, and invalid dimensions throw.

- [ ] **Step 2: Implement `SceneBuffers`**

Allocate all typed arrays in one method. Preserve deterministic glyph/churn initialization by accepting injected random streams.

- [ ] **Step 3: Write failing quality-controller tests**

Cover explicit-tier stability, viewport-derived initial auto tier, two slow 120-frame windows stepping down, four fast windows stepping up, eight-second cooldown, exclusion of hidden/resize frames, and no movement below low/above high.

- [ ] **Step 4: Implement `QualityController`**

Interface:

```javascript
const quality = new QualityController({ policy, now });
quality.chooseInitial({ width, height, dpr });
quality.sample(frameMilliseconds, { hidden, resizing });
quality.setPolicy(policy);
quality.getSnapshot();
```

Emit `change` with `{ policy, tier, reason }` only when material state changes.

- [ ] **Step 5: Replace renderer-owned arrays and quality logic**

`CodefallRenderer.resize()` asks the controller for a tier, resizes `SceneBuffers`, updates model grid, and rebuilds atlas/rain only when geometry or resolution changed. Delete the current `detectQuality()` implementation.

- [ ] **Step 6: Add renderer quality events and public delegation**

Renderer forwards quality changes; `CodefallFace.setQuality` updates the controller and emits existing/new snapshot state without recreating the whole face.

- [ ] **Step 7: Run tests and coverage**

```bash
rtk node --test test/scene-buffers.test.js test/quality-controller.test.js test/renderer-helpers.test.js
rtk npm run test:coverage
```

Expected: all tests pass; quality controller and scene buffers have at least 90% line and branch coverage.

- [ ] **Step 8: Commit**

```bash
rtk git add src/face/scene-buffers.js src/face/quality-controller.js src/face/renderer.js test/scene-buffers.test.js test/quality-controller.test.js test/renderer-helpers.test.js
rtk git commit -m "refactor: add reusable scene buffers and adaptive quality"
```

---

## Task 8: Split ordered Canvas passes without changing the picture

**Files:**
- Create: `src/face/render-passes.js`
- Modify: `src/face/renderer.js`
- Create: `test/render-passes.test.js`
- Create: `test/renderer.test.js`

### Pass interface

```javascript
export function renderFrame(context) {
  backgroundPass(context);
  rainPass(context);
  facePass(context);
  substratePass(context);
  debrisPass(context);
  featureGlowPass(context);
  haloPass(context);
}
```

`context` is one renderer-owned, preallocated object containing canvas context, dimensions, buffers, atlas, frame state, theme, possession/event state, particles, and random streams.

- [ ] **Step 1: Add a recording-canvas renderer characterization test**

For a fixed seed, grid, theme, geometry, and frame state, record the ordered drawing operations and stable numeric arguments. Assert pass order, transform restoration, composite-operation restoration, and a bounded operation count rather than pixel-perfect browser rasterization.

- [ ] **Step 2: Run characterization test on the current renderer**

Run: `rtk node --test test/renderer.test.js`

Expected: test passes against the pre-extraction behavior.

- [ ] **Step 3: Extract pass functions in order**

Move code without tuning constants. Each pass MUST restore `globalAlpha`, `globalCompositeOperation`, shadow settings, and transforms it changes. Passes do not schedule events or allocate frame-sized storage.

- [ ] **Step 4: Add focused pass tests**

Cover:

- reduced motion performs an opaque clear and no trail fade;
- rain never offsets void/background cells with face bands;
- substrate draws only where the substrate buffer is positive;
- debris respects tier limits;
- eye glow is skipped for a closed blink;
- Wintermute halo preserves its right-side gap;
- Codefall halo remains compatible.

- [ ] **Step 5: Remove migrated responsibilities from renderer**

`CodefallRenderer` should own canvas/atlas/buffers/context composition, resize, theme/geometry invalidation, quality wiring, render entry, and metrics. It should not contain separate large loops for each effect.

- [ ] **Step 6: Run full verification**

```bash
rtk node --test test/render-passes.test.js test/renderer.test.js
rtk npm test
```

- [ ] **Step 7: Commit**

```bash
rtk git add src/face/render-passes.js src/face/renderer.js test/render-passes.test.js test/renderer.test.js
rtk git commit -m "refactor: separate ordered canvas render passes"
```

---

## Task 9: Add anatomical depth, machine substrate, and richer articulation

**Files:**
- Modify: `src/face/face-model.js`
- Modify: `src/face/glyphs.js`
- Modify: `src/face/render-passes.js`
- Modify: `src/face/emotions.js`
- Modify: `test/face-model.test.js`
- Modify: `test/glyphs.test.js`
- Create: `test/anatomy-regression.test.js`

### New regions and fields

Add region constants for `BROW_RIDGE`, `ORBIT`, `NOSE_PLANE`, `NOSTRIL`, `CHEEK_PLANE`, `JAW_HINGE`, `CHIN_PLATE`, `TEMPLE_PORT`, and `NECK_TENDON`. Add material vocabularies for actuator, conduit, cavity, and plate while preserving all existing numeric values.

- [ ] **Step 1: Write failing anatomy landmark tests**

For both geometries and three grid sizes, assert:

- bilateral eye/orbit regions are present and symmetric within one cell;
- nose bridge connects glabella to tip without entering the oral cavity;
- cheek planes sit lateral/below orbits;
- upper/lower lip enclose a darker mouth cavity while speaking;
- jaw hinges connect to the jaw silhouette;
- temple port remains inside the head;
- neck tendons connect chin/jaw to the lower data field;
- depth and substrate values are finite and within `[0, 1]`.

- [ ] **Step 2: Run anatomy tests and confirm failure**

Run: `rtk node --test test/anatomy-regression.test.js`

- [ ] **Step 3: Extend the model output contract**

Change `fill` to accept the buffer object from `SceneBuffers`. Keep a compatibility overload for the existing positional arrays during this task, then remove the overload after all callers/tests migrate in this same task.

Compute depth as scalar combinations of head distance, feature plane, and cavity masks. Compute substrate independently from brightness so breaches can reveal machinery under intact anatomy.

- [ ] **Step 4: Implement richer mouth articulation**

Map `mouthOpen`, `mouthWide`, `tension`, and `energy` into separate upper lip, lower lip, oral cavity, corner pull, compression, and small deterministic asymmetry fields. Neutral/silent frames MUST retain closed lips and no cavity leak.

- [ ] **Step 5: Add expression parameter coverage**

For all nine existing emotions, verify every parameter is finite/in range and the resulting face retains eyes, nose, mouth, jaw, and non-empty silhouette. Strong emotions may move landmarks but not invert them.

- [ ] **Step 6: Render the substrate and pseudo-depth**

Use depth to select brightness/tile density without creating gradients per cell. During visual events, expose actuator/conduit/cavity glyphs only where `substrate > threshold`. Keep machine apertures cyan-white in Wintermute and theme-consistent in Codefall.

- [ ] **Step 7: Run focused/full tests and allocation guard**

```bash
rtk node --test test/face-model.test.js test/glyphs.test.js test/anatomy-regression.test.js
rtk npm test
rtk rg -n "new |\[\]|Array\.from|\.map\(|\.filter\(" src/face/face-model.js src/face/render-passes.js
```

Review every match inside per-cell/per-row loops; move construction outside the hot path.

- [ ] **Step 8: Commit**

```bash
rtk git add src/face/face-model.js src/face/glyphs.js src/face/render-passes.js src/face/emotions.js test/face-model.test.js test/glyphs.test.js test/anatomy-regression.test.js
rtk git commit -m "feat: deepen cybernetic facial anatomy"
```

---

## Task 10: Integrate the visual-event grammar

**Files:**
- Modify: `src/runtime/visual-event-scheduler.js`
- Modify: `src/runtime/face-runtime.js`
- Modify: `src/face/render-passes.js`
- Modify: `src/face/glyphs.js`
- Modify: `src/config.js`
- Modify: `test/visual-event-scheduler.test.js`
- Create: `test/visual-events-integration.test.js`

- [ ] **Step 1: Add configuration validation tests**

Assert default `visualIntensity` is `0.65`; finite values clamp to `[0,1]`; strings, NaN, and infinity fall back with a diagnostic; seed accepts null or unsigned 32-bit integers.

- [ ] **Step 2: Add seeded event integration tests**

Advance a fake runtime for 60 seconds and assert deterministic event sequence/cadence, never-overlapping medium/major events, maximum displacement 12 cells, breach duration at most 650 ms, and stable anatomy buffers outside the active bands.

- [ ] **Step 3: Render seam crawl and ocular desync**

Seam crawl changes only seam/actuator intensity. Ocular desync may offset one eye glow by at most one cell and desaturate it briefly; it MUST NOT move the eye region in the model.

- [ ] **Step 4: Render mask slip and aperture breach**

Mask slip offsets selected face tiles while stable features remain anchored. Aperture breach combines localized tile displacement, a dark cavity, cyan-white rim hardware, and halo interruption using substrate masks.

- [ ] **Step 5: Implement accessibility transformations**

In reduced motion:

- seam crawl becomes a static 300 ms seam emphasis;
- ocular desync is suppressed;
- mask slip is suppressed;
- aperture breach becomes a static, non-flashing aperture with no displacement or debris.

- [ ] **Step 6: Expose visual event and intensity APIs**

`FaceRuntime` emits event phase changes; `CodefallFace` forwards `visualevent`. `setVisualIntensity` updates cadence/amplitude for future events and snapshot state.

- [ ] **Step 7: Run focused and full tests**

```bash
rtk node --test test/visual-event-scheduler.test.js test/visual-events-integration.test.js
rtk npm test
```

- [ ] **Step 8: Commit**

```bash
rtk git add src/runtime src/face src/config.js test/visual-event-scheduler.test.js test/visual-events-integration.test.js
rtk git commit -m "feat: add deterministic borrowed-face event grammar"
```

---

## Task 11: Rebuild the control deck as an accessible API consumer

**Files:**
- Create: `src/ui/control-deck.js`
- Create: `src/ui/preferences.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `styles.css`
- Create: `test/preferences.test.js`
- Create: `test/control-deck.test.js`

### Preference contract

Store only versioned presentation data:

```javascript
{
  version: 1,
  theme: 'wintermute',
  geometry: 'chiseled',
  quality: 'auto',
  motion: 'system',
  visualIntensity: 0.65,
  dock: 'center',
  collapsed: false,
}
```

- [ ] **Step 1: Write preference validation tests**

Cover missing/corrupt storage, version mismatch, invalid enum/numeric values, partial records, save failure, and reset. Never store transcripts, provider credentials, messages, or debug snapshots.

- [ ] **Step 2: Implement preferences**

Export `loadPreferences(storage)`, `savePreferences(storage, value)`, and `clearPreferences(storage)`. All functions are non-throwing and return normalized data/result objects.

- [ ] **Step 3: Write control-deck behavior tests**

Using a minimal fake DOM and fake face event target, verify controls call only public facade methods; state/capability events update labels and disabled states; icon toggles update accessible names/pressed state; transcript partials do not spam the live region; retry is shown only when supported; and destroy removes listeners.

- [ ] **Step 4: Implement `ControlDeck`**

```javascript
const deck = new ControlDeck({ root, face, storage });
deck.mount();
deck.destroy();
```

Move DOM wiring, transcript rendering, emotion buttons, docking/dragging, debug stats, and preference persistence from `main.js`. Keep `main.js` responsible only for config/query parsing, `CodefallFace` construction, `ControlDeck` construction, demo wiring, and page teardown.

- [ ] **Step 5: Update HTML controls**

Add labeled controls for provider retry, Calm/Standard/Breach intensity, Auto/High/Medium/Low quality, system/reduce/full motion policy, and diagnostic snapshot copy. Use native buttons/select/range inputs. Add an offscreen polite status live region separate from the transcript.

- [ ] **Step 6: Fix accessibility defects and styling**

- remove `user-scalable=no` from the viewport meta tag;
- add `:focus-visible` styles with at least 2 px outline and offset;
- keep all touch targets at least 44 by 44 CSS px;
- add text/state indicators alongside color;
- add `aria-controls`, `aria-expanded`, `aria-pressed`, and `aria-selected` where appropriate;
- make docking keyboard-operable and dragging optional;
- ensure 320 px width has no horizontal overflow;
- preserve reduced-motion CSS behavior.

- [ ] **Step 7: Run unit and syntax tests**

```bash
rtk node --test test/preferences.test.js test/control-deck.test.js
rtk node --check src/ui/control-deck.js
rtk node --check src/main.js
rtk npm test
```

- [ ] **Step 8: Commit**

```bash
rtk git add src/ui src/main.js index.html styles.css test/preferences.test.js test/control-deck.test.js
rtk git commit -m "feat: add accessible product control deck"
```

---

## Task 12: Decompose and harden the optional server

**Files:**
- Create: `server/lib/http-utils.mjs`
- Create: `server/lib/static-handler.mjs`
- Create: `server/lib/azure-relay.mjs`
- Create: `server/lib/lacy-handler.mjs`
- Create: `server/lib/piper-handler.mjs`
- Create: `server/lib/face-hub.mjs`
- Modify: `server/server.mjs`
- Modify: `server/.env.example`
- Modify: `server/package.json`
- Create: `test/server-http-utils.test.js`
- Create: `test/server-static.test.js`
- Create: `test/server-face-hub.test.js`
- Create: `test/server-lifecycle.test.js`

- [ ] **Step 1: Write bounded JSON and security-header tests**

Test valid JSON, malformed JSON, empty input, 64 KiB boundary, over-limit early termination, JSON response shape, request ID inclusion, CSP, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

- [ ] **Step 2: Implement HTTP utilities**

```javascript
export async function readJson(req, { maxBytes = 65536 } = {}) {}
export function sendJson(res, status, body, headers = {}) {}
export function applySecurityHeaders(res, { requestId, csp }) {}
export function createRequestId(randomBytes) {}
```

- [ ] **Step 3: Write safe-static tests**

Cover `/`, JS/CSS/assets, URL encoding, `..`, dotfiles, `.env`, `server/`, model files, directories, missing files, HEAD, ETag/304, and cache policy. Static paths resolve under the repository root after canonicalization or return 404.

- [ ] **Step 4: Implement the static handler**

Do not expose server files, voices, virtual environments, source maps, Git metadata, or planning artifacts. HTML gets `no-cache`; hashed assets may get immutable caching; current un-hashed JS/CSS gets revalidation.

- [ ] **Step 5: Write face-hub tests**

Cover token auth, origin allowlist, command parser reuse/equivalence, 1 MiB WebSocket limit, 200-event ring buffer, webhook timeout, socket cleanup, status/events endpoints, and graceful close.

- [ ] **Step 6: Extract face hub, Azure, Lacy, and Piper handlers**

Each module exports a factory returning `{ handle, getHealth, close }`. Handler modules own their sockets/processes/timeouts. `close()` is idempotent and awaits resource termination.

- [ ] **Step 7: Make `server.mjs` a composition root**

It loads validated environment configuration, constructs handlers, routes requests/upgrades, writes structured one-line JSON logs, exposes `/healthz`, and handles SIGINT/SIGTERM by closing the HTTP server and all handlers before exit.

- [ ] **Step 8: Add environment documentation**

Add `ALLOWED_ORIGINS`, `MAX_JSON_BYTES`, `MAX_WS_BYTES`, `LOG_LEVEL`, and `SHUTDOWN_TIMEOUT_MS` to `.env.example` with secure defaults. Never print secret values.

- [ ] **Step 9: Run server and full tests**

```bash
rtk node --test test/server-http-utils.test.js test/server-static.test.js test/server-face-hub.test.js test/server-lifecycle.test.js
rtk npm test
rtk npm --prefix server test
```

Add `"test": "node --test ../test/server-*.test.js"` to `server/package.json` if the command is missing.

- [ ] **Step 10: Commit**

```bash
rtk git add server test/server-http-utils.test.js test/server-static.test.js test/server-face-hub.test.js test/server-lifecycle.test.js
rtk git commit -m "refactor: harden server handlers and lifecycle"
```

---

## Task 13: Add browser, visual, accessibility, and performance gates

**Files:**
- Modify: `package.json`
- Create: `playwright.config.js`
- Create: `test/browser/face.spec.js`
- Create: `test/browser/accessibility.spec.js`
- Create: `test/browser/lifecycle.spec.js`
- Create: `test/browser/performance.spec.js`
- Create: `test/browser/visual.spec.js`
- Create: `test/browser/visual.spec.js-snapshots/` through Playwright snapshot generation

- [ ] **Step 1: Install Playwright as development-only tooling**

Run:

```bash
rtk npm install --save-dev @playwright/test@1.61.0
rtk npx playwright install chromium webkit
```

Confirm `dependencies` remains absent/empty in the root package and only `devDependencies` changes.

- [ ] **Step 2: Configure static web server and projects**

Create `playwright.config.js`:

```javascript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://127.0.0.1:4173/' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 12'] } },
    {
      name: 'reduced-motion',
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
  ],
});
```

- [ ] **Step 3: Add product flow tests**

Verify boot to idle, TALK with local provider, interruption, mute, theme, geometry, all emotions, quality, intensity presets, transcript limit, console collapse/dock, diagnostics copy, and no uncaught console/page errors.

- [ ] **Step 4: Add accessibility tests**

Use role/name locators. Verify keyboard traversal/action, visible focus, correct pressed/expanded/selected states, zoom-friendly viewport, status live region, no horizontal overflow at 320/390 px, 44 px control targets, and reduced-motion state.

- [ ] **Step 5: Add lifecycle tests**

Create/destroy embedded faces repeatedly through `page.evaluate`. Assert canvases/listeners/RAF/provider timers/socket reconnect attempts return to baseline and multiple instances retain independent container datasets.

- [ ] **Step 6: Add deterministic visual snapshots**

Use an explicit seed and expose a debug-only deterministic scene driver when `?testMode=1`. Capture the face/stage, not the entire browser chrome, for:

- Wintermute chiseled neutral;
- Wintermute smooth speech;
- Wintermute chiseled breach;
- Codefall chiseled anger;
- mobile neutral;
- reduced-motion breach substitute.

Mask transcript text and FPS counters. Store snapshots per browser project only after human review.

- [ ] **Step 7: Add performance instrumentation test**

Run the deterministic 30-second scene and read `getSnapshot()` samples. Assert no non-finite values, no tier oscillation, particle peak within tier limit, and no single scripted update above a broad 100 ms CI guard. Record FPS but do not enforce real-device FPS in virtualized CI.

- [ ] **Step 8: Add scripts and run browser suite**

Update root scripts:

```json
{
  "test:browser": "playwright test",
  "test:browser:update": "playwright test test/browser/visual.spec.js --update-snapshots",
  "test:all": "npm run test:unit && npm run test:browser"
}
```

Run:

```bash
rtk npm run test:unit
rtk npm run test:browser
```

- [ ] **Step 9: Commit**

```bash
rtk git add package.json package-lock.json playwright.config.js test/browser
rtk git commit -m "test: add cross-browser face quality gates"
```

---

## Task 14: Documentation, compatibility audit, and release verification

**Files:**
- Modify: `README.md`
- Modify: `docs/INTEGRATIONS.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/ACCESSIBILITY.md`
- Create: `docs/PERFORMANCE.md`
- Modify: `docs/superpowers/plans/2026-08-20-codefall-face-3.md`

- [ ] **Step 1: Document module ownership and data flow**

`ARCHITECTURE.md` must name each deep module, its external/internal seams, state ownership, lifecycle, and allowed dependency direction. Include the runtime-to-render flow and provider/agent event flow.

- [ ] **Step 2: Update README usage without breaking old examples**

Keep the original constructor and API example. Add optional 3.0 methods, quality/intensity controls, deterministic seed use, snapshots, unsubscribe, and complete destroy semantics.

- [ ] **Step 3: Document accessibility and performance contracts**

Record keyboard controls, screen-reader behavior, motion transformations, zoom/mobile support, target frame rates, quality hysteresis, particle limits, and the exact commands for unit/browser/performance verification.

- [ ] **Step 4: Run the compatibility matrix**

Verify manually and in browser tests:

| Theme | Geometry | Desktop | Mobile | Reduced motion | Speech | Strong emotion | Breach |
|---|---|---|---|---|---|---|---|
| Wintermute | chiseled | yes | yes | yes | yes | yes | yes |
| Wintermute | smooth | yes | yes | yes | yes | yes | yes |
| Codefall | chiseled | yes | yes | yes | yes | yes | yes |
| Codefall | smooth | yes | yes | yes | yes | yes | yes |

Record any intended visual baseline update in the plan checkbox notes before committing snapshots.

- [ ] **Step 5: Run fresh complete verification**

```bash
rtk npm run test:all
rtk npm run test:coverage
rtk npm --prefix server test
rtk node --check src/codefall-face.js
rtk node --check src/main.js
rtk node --check server/server.mjs
rtk git diff --check
rtk git status --short
```

Expected: all unit/server/browser tests pass, syntax checks exit zero, diff check is clean, and only intended documentation/snapshot changes remain.

- [ ] **Step 6: Perform final code review**

Review the full branch against `docs/superpowers/specs/2026-08-20-codefall-face-3-design.md`. Treat public API breakage, lifecycle leaks, stale provider publication, accessibility regressions, secret exposure, and per-cell allocation as release blockers.

- [ ] **Step 7: Commit documentation and verification record**

```bash
rtk git add README.md docs
rtk git commit -m "docs: complete CodeFallFace 3.0 architecture"
```

---

## Delivery Definition

The milestone is complete only when:

- every task is checked and committed atomically;
- the original public API contract test remains green;
- unit, server, and browser suites pass from a clean checkout;
- browser runtime dependencies remain zero;
- the manual compatibility matrix is recorded;
- the full-branch review has no unresolved critical or important findings;
- the deployed static demo is smoke-tested after merge.
