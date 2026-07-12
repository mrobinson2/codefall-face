# Cyberpunk Voxel Face Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a chiseled, tile-skinned digital human with a broken white halo, dark speech aperture, falling data blocks, and rare possession glitches.

**Architecture:** Keep anatomy in `FaceModel` and rendering in `CodefallRenderer`. Add a pure `PossessionController` for deterministic event timing, a material buffer that separates anatomy from surface treatment, and pure geometry helpers for halo and glitch calculations. Preserve the atlas-based 2D canvas pipeline and the legacy green theme.

**Tech Stack:** Browser ES modules, Canvas 2D, typed arrays, Node.js built-in test runner, HTML/CSS demo.

## Global Constraints

- Set `wintermute` as the default theme and keep `codefall` selectable.
- Keep the current speech, emotion, blink, gaze, boot, resize, and public API behavior.
- Schedule possession events 7 to 18 seconds apart; each event lasts 180 to 650 milliseconds.
- Disable slice displacement, feature duplication, and flashing in reduced-motion mode.
- Avoid per-cell object allocation in the render loop.
- Use high, medium, and low detail tiers without adding runtime dependencies.
- Treat the supplied images as visual references only; do not ship or copy them into the product.

---

## File Structure

- Create `package.json`: root test command and ES module declaration.
- Create `src/face/possession.js`: deterministic event scheduling, pulse envelope, band clamping, and row offsets.
- Create `test/possession.test.js`: possession controller unit tests.
- Create `test/face-model.test.js`: angular silhouette and material classification tests.
- Create `test/glyphs.test.js`: wintermute material-to-glyph tests.
- Create `test/renderer-helpers.test.js`: halo segments, row displacement, and quality limits.
- Create `test/config.test.js`: theme default and override tests.
- Modify `src/face/glyphs.js`: material flags, tile vocabularies, theme detail settings, and deterministic wintermute glyph selection.
- Modify `src/face/face-model.js`: chiseled head width, planar lighting, tile materials, apertures, and dark mouth interior.
- Modify `src/face/renderer.js`: material buffer, stable tile rendering, halo, possession integration, and disintegration.
- Modify `src/config.js`: wintermute default.
- Modify `README.md`: default appearance, theme override, and reduced-motion behavior.

---

### Task 1: Add the deterministic possession controller

**Files:**
- Create: `package.json`
- Create: `src/face/possession.js`
- Create: `test/possession.test.js`

**Interfaces:**
- Consumes: `random(): number` returning a value in `[0, 1)`.
- Produces: `clampBand(start, height, rows)` and `PossessionController.update(now, options)`.
- `update` returns `{ active, envelope, bands, aperture, haloDrop }`. Each band has `start`, `height`, and `offset` in grid cells.

- [ ] **Step 1: Add the root test command**

Create `package.json`:

```json
{
  "name": "codefall-face",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
```

- [ ] **Step 2: Write failing possession tests**

Create `test/possession.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBand, PossessionController } from '../src/face/possession.js';

const fixedRandom = () => 0;

test('clampBand keeps a band inside the grid', () => {
  assert.deepEqual(clampBand(-3, 9, 20), { start: 0, height: 6 });
  assert.deepEqual(clampBand(18, 8, 20), { start: 18, height: 2 });
});

test('controller waits at least seven seconds before a breach', () => {
  const controller = new PossessionController(fixedRandom);
  assert.equal(controller.update(6.99, { rows: 40 }).active, false);
  assert.equal(controller.update(7, { rows: 40 }).active, true);
});

test('reduced motion suppresses possession output', () => {
  const controller = new PossessionController(fixedRandom);
  const frame = controller.update(20, { rows: 40, reducedMotion: true });
  assert.deepEqual(frame, {
    active: false, envelope: 0, bands: [], aperture: null, haloDrop: 0,
  });
});

test('an event ends and schedules a future event', () => {
  const controller = new PossessionController(fixedRandom);
  controller.update(7, { rows: 40 });
  assert.equal(controller.update(7.7, { rows: 40 }).active, false);
  assert.equal(controller.update(13, { rows: 40 }).active, false);
  assert.equal(controller.update(14.7, { rows: 40 }).active, true);
});
```

- [ ] **Step 3: Run the tests and confirm the missing-module failure**

Run: `npm test`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/face/possession.js`.

- [ ] **Step 4: Implement the controller**

Create `src/face/possession.js`:

```javascript
const IDLE = Object.freeze({
  active: false,
  envelope: 0,
  bands: [],
  aperture: null,
  haloDrop: 0,
});

export function clampBand(start, height, rows) {
  const rawStart = Math.floor(start);
  const rawEnd = rawStart + Math.floor(height);
  const safeStart = Math.max(0, Math.min(rows, rawStart));
  const safeEnd = Math.max(safeStart, Math.min(rows, rawEnd));
  return {
    start: safeStart,
    height: safeEnd - safeStart,
  };
}

function range(random, min, max) {
  return min + random() * (max - min);
}

export class PossessionController {
  constructor(random = Math.random) {
    this.random = random;
    this.active = null;
    this.nextAt = range(random, 7, 18);
  }

  reset(now = 0) {
    this.active = null;
    this.nextAt = now + range(this.random, 7, 18);
  }

  start(now, rows, intensity) {
    const duration = range(this.random, 0.18, 0.65);
    const count = 2 + Math.floor(this.random() * 2);
    const bands = [];
    for (let i = 0; i < count; i++) {
      const raw = clampBand(
        this.random() * rows,
        2 + this.random() * Math.max(3, rows * 0.08),
        rows,
      );
      bands.push({
        ...raw,
        offset: Math.round(range(this.random, -5, 5) * intensity) || 1,
      });
    }
    this.active = {
      start: now,
      duration,
      bands,
      aperture: {
        side: this.random() < 0.5 ? -1 : 1,
        y: range(this.random, -0.2, 0.58),
        radius: range(this.random, 0.06, 0.13),
      },
    };
  }

  update(now, options = {}) {
    const rows = Math.max(1, options.rows || 1);
    if (options.reducedMotion) {
      this.reset(now);
      return IDLE;
    }
    const intensity = Math.max(0.45, Math.min(1.4, options.intensity || 1));
    if (!this.active && now >= this.nextAt) this.start(now, rows, intensity);
    if (!this.active) return IDLE;

    const progress = (now - this.active.start) / this.active.duration;
    if (progress >= 1) {
      this.active = null;
      this.nextAt = now + range(this.random, 7, 18);
      return IDLE;
    }
    const pulse = Math.abs(Math.sin(progress * Math.PI * 3));
    return {
      active: true,
      envelope: pulse,
      bands: this.active.bands,
      aperture: this.active.aperture,
      haloDrop: pulse * 0.55,
    };
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json src/face/possession.js test/possession.test.js
git commit -m "feat: add possession event controller"
```

---

### Task 2: Add material-aware wintermute glyphs

**Files:**
- Modify: `src/face/glyphs.js:11-64`
- Create: `test/glyphs.test.js`

**Interfaces:**
- Produces: `MATERIAL` numeric flags and `wintermuteGlyphFor(material, intensity, seed)`.
- Later tasks pass `material[i]` and `churnPhase[i]` into the glyph selector.

- [ ] **Step 1: Write failing glyph tests**

Create `test/glyphs.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATLAS_CHARS, MATERIAL, MACHINE, SEAMS, TILES_FINE, TILES_WIDE,
  wintermuteGlyphFor,
} from '../src/face/glyphs.js';

test('every wintermute material glyph exists in the atlas', () => {
  for (const chars of [TILES_WIDE, TILES_FINE, SEAMS, MACHINE]) {
    for (const char of chars) assert.ok(ATLAS_CHARS.includes(char), char);
  }
});

test('material selection is deterministic for a fixed seed', () => {
  assert.equal(
    wintermuteGlyphFor(MATERIAL.FINE, 0.7, 0.42),
    wintermuteGlyphFor(MATERIAL.FINE, 0.7, 0.42),
  );
});

test('aperture material selects a dark machine glyph', () => {
  assert.ok(MACHINE.includes(wintermuteGlyphFor(MATERIAL.MACHINE, 0.8, 0.5)));
});
```

- [ ] **Step 2: Run the glyph test and confirm export failures**

Run: `node --test --test-name-pattern="wintermute|material|aperture" test/*.test.js`

Expected: FAIL because `MATERIAL` and the new vocabularies do not exist.

- [ ] **Step 3: Add material flags and vocabularies**

Add these exports above `REGION` in `src/face/glyphs.js`:

```javascript
export const TILES_WIDE = '▪■□';
export const TILES_FINE = '·▫▪';
export const SEAMS = '¦—/\\';
export const MACHINE = '0OØ◉#';

export const MATERIAL = {
  NONE: 0,
  TILE: 1,
  FINE: 2,
  SEAM: 3,
  APERTURE: 4,
  MACHINE: 5,
  LOOSE: 6,
};

export function wintermuteGlyphFor(material, intensity, seed) {
  const vocab = material === MATERIAL.FINE ? TILES_FINE
    : material === MATERIAL.SEAM ? SEAMS
      : material === MATERIAL.APERTURE || material === MATERIAL.MACHINE ? MACHINE
        : TILES_WIDE;
  const lightBias = Math.min(vocab.length - 1, Math.floor(intensity * vocab.length));
  const jitter = Math.floor(seed * vocab.length) % vocab.length;
  return vocab[(lightBias + jitter) % vocab.length];
}
```

Extend `ATLAS_CHARS` so its union includes `TILES_WIDE + TILES_FINE + SEAMS + MACHINE`. Extend theme records:

```javascript
export const THEMES = {
  codefall: {
    name: 'codefall', hue: 140, sat: 1.0, blocky: false,
    rainDim: 1.0, ring: 0.22, detail: 0.45,
  },
  wintermute: {
    name: 'wintermute', hue: 204, sat: 0.13, blocky: true,
    rainDim: 0.42, ring: 1.0, detail: 1.0,
  },
};
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/face/glyphs.js test/glyphs.test.js
git commit -m "feat: add wintermute material glyphs"
```

---

### Task 3: Build the chiseled tile face model

**Files:**
- Modify: `src/face/face-model.js:21-282`
- Create: `test/face-model.test.js`

**Interfaces:**
- Produces: `headHalfWidth(v, mouthOpen, jawSharp)` and `classifyFaceMaterial(u, v, noise, region)`.
- Changes `FaceModel.fill` to `fill(bright, region, sdf, material, p, dyn)`.
- Material values come from `MATERIAL` in `glyphs.js`.

- [ ] **Step 1: Write failing geometry tests**

Create `test/face-model.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { headHalfWidth, classifyFaceMaterial } from '../src/face/face-model.js';
import { MATERIAL, REGION } from '../src/face/glyphs.js';

test('head width creates temple, cheek, jaw, and chin breaks', () => {
  const temple = headHalfWidth(-0.55, 0, 0.5);
  const cheek = headHalfWidth(-0.08, 0, 0.5);
  const jaw = headHalfWidth(0.48, 0, 0.5);
  const chin = headHalfWidth(0.96, 0, 0.5);
  assert.ok(cheek > temple);
  assert.ok(jaw < cheek);
  assert.ok(chin < jaw);
});

test('eye and mouth anatomy receives fine material', () => {
  assert.equal(classifyFaceMaterial(0.2, -0.16, 0.3, REGION.EYE), MATERIAL.FINE);
  assert.equal(classifyFaceMaterial(0.1, 0.55, 0.3, REGION.MOUTH), MATERIAL.FINE);
});

test('temple port receives aperture material', () => {
  assert.equal(classifyFaceMaterial(0.49, 0.12, 0.9, REGION.FACE), MATERIAL.APERTURE);
});
```

- [ ] **Step 2: Run the face-model tests and confirm export failures**

Run: `node --test --test-name-pattern="head width|anatomy|temple" test/*.test.js`

Expected: FAIL because both helper exports are missing.

- [ ] **Step 3: Add pure geometry and material helpers**

Change the import to `import { MATERIAL, REGION } from './glyphs.js';` and add:

```javascript
export function headHalfWidth(v, mouthOpen = 0, jawSharp = 0.5) {
  const points = [
    [-0.82, 0.42],
    [-0.55, 0.52],
    [-0.08, 0.62],
    [0.38, 0.48 + jawSharp * 0.035],
    [0.68, 0.34],
    [1.0 + mouthOpen * 0.05, 0.09],
  ];
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (v <= points[i][0]) {
      const [v0, w0] = points[i - 1];
      const [v1, w1] = points[i];
      const t = (v - v0) / (v1 - v0);
      return w0 + (w1 - w0) * t;
    }
  }
  return points[points.length - 1][1];
}

export function classifyFaceMaterial(u, v, noise, region) {
  if (region === REGION.EYE || region === REGION.MOUTH || region === REGION.NOSE) {
    return MATERIAL.FINE;
  }
  if (region === REGION.MOUTH_INNER) return MATERIAL.MACHINE;
  const port = u > 0.43 && u < 0.56 && v > 0.02 && v < 0.22;
  if (port) return MATERIAL.APERTURE;
  const seam = Math.abs(Math.abs(u) - (0.24 + (v + 0.2) * 0.24)) < 0.018;
  if (seam && v > -0.35 && v < 0.72) return MATERIAL.SEAM;
  return noise > 0.72 ? MATERIAL.FINE : MATERIAL.TILE;
}
```

- [ ] **Step 4: Replace the smooth skull and jaw calculation**

Inside `fill`, replace the skull ellipse and jaw wedge with this piecewise distance:

```javascript
const vChin = 1.0 + dyn.mouthOpen * 0.05;
const top = -0.86;
const bottomDistance = (v1 - vChin) / 0.16;
const halfWidth = headHalfWidth(v1, dyn.mouthOpen, p.jawSharp);
const sideDistance = (Math.abs(u0) - halfWidth) / 0.28;
let d = Math.max(sideDistance, bottomDistance, (top - v1) / 0.16);
const crown = Math.hypot(u0 / 0.48, (v1 + 0.6) / 0.32) - 1;
if (v1 < -0.42) d = Math.min(d, crown);
sdf[i] = d;
```

At the top of each cell iteration, initialize `material[i] = MATERIAL.NONE`. On every outside-head branch set `MATERIAL.LOOSE` for shards. Before storing the final cell, set:

```javascript
material[i] = classifyFaceMaterial(u0, v1, nz, reg);

const foreheadLight = Math.max(0, 1 - Math.hypot(u0 / 0.5, (v1 + 0.52) / 0.42));
const cheekLight = Math.max(0, 1 - Math.hypot((Math.abs(u0) - 0.3) / 0.23, (v1 - 0.08) / 0.3));
const sideFalloff = 1 - Math.min(0.55, Math.abs(u0) * 0.65);
if (reg === REGION.FACE) b += foreheadLight * 0.22 + cheekLight * 0.18;
if (material[i] === MATERIAL.SEAM) b *= 0.38;
if (material[i] === MATERIAL.APERTURE) b = 0.025;
if (reg !== REGION.EYE) b *= sideFalloff;
```

Change the signature to:

```javascript
fill(bright, region, sdf, material, p, dyn) {
```

Keep the existing brow, eye, nose, mouth, emotion, gaze, blink, and coherence sections. Change the open inner-mouth brightness to `0.01 + dyn.energy * 0.06` so speech exposes a black cavity.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/face/face-model.js test/face-model.test.js
git commit -m "feat: sculpt chiseled tile face"
```

---

### Task 4: Render the stable tile apparition and broken halo

**Files:**
- Modify: `src/face/renderer.js:19-329,371-418`
- Create: `test/renderer-helpers.test.js`

**Interfaces:**
- Consumes: `MATERIAL`, `wintermuteGlyphFor`, and the material buffer from Task 3.
- Produces: `ringSegments(time, reducedMotion, breach)` and `rowOffset(row, possession)` for Task 5.

- [ ] **Step 1: Write failing renderer-helper tests**

Create `test/renderer-helpers.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { ringSegments, rowOffset } from '../src/face/renderer.js';

test('wintermute ring keeps a large right-side gap', () => {
  const arcs = ringSegments(0, true, 0);
  assert.equal(arcs.length, 2);
  assert.ok(arcs[0].end - arcs[0].start < Math.PI * 1.8);
});

test('rowOffset returns zero outside active bands', () => {
  assert.equal(rowOffset(12, { active: true, envelope: 1, bands: [
    { start: 3, height: 4, offset: 5 },
  ] }), 0);
});

test('rowOffset scales a matching band by its envelope', () => {
  assert.equal(rowOffset(5, { active: true, envelope: 0.5, bands: [
    { start: 3, height: 4, offset: 6 },
  ] }), 3);
});
```

- [ ] **Step 2: Run the tests and confirm helper export failures**

Run: `node --test --test-name-pattern="ring|rowOffset" test/*.test.js`

Expected: FAIL because `ringSegments` and `rowOffset` do not exist.

- [ ] **Step 3: Add pure renderer helpers**

Add above `CodefallRenderer`:

```javascript
export function ringSegments(time, reducedMotion, breach = 0) {
  const drift = reducedMotion ? 0 : Math.sin(time * 0.08) * 0.035;
  const gap = 0.54 + breach * 0.22;
  return [
    { start: -Math.PI * 0.42 + drift, end: Math.PI * (1.38 - gap) + drift },
    { start: Math.PI * (1.47 + gap * 0.2) - drift, end: Math.PI * 1.76 - drift },
  ];
}

export function rowOffset(row, possession) {
  if (!possession?.active) return 0;
  let offset = 0;
  for (const band of possession.bands) {
    if (row >= band.start && row < band.start + band.height) {
      offset += band.offset * possession.envelope;
    }
  }
  return Math.round(offset);
}
```

- [ ] **Step 4: Allocate and fill the material buffer**

Import `MATERIAL` and `wintermuteGlyphFor`. In `resize` add:

```javascript
this.material = new Uint8Array(n);
```

Change the model call to:

```javascript
this.model.fill(this.bright, this.region, this.sdf, this.material, p, dyn);
```

In `pickGlyph`, before the region switch, add:

```javascript
if (this.theme.name === 'wintermute' && reg !== REGION.VOID) {
  const char = wintermuteGlyphFor(material, intensity, seed);
  return CHAR_INDEX.get(char);
}
```

Change the signature to `pickGlyph(reg, material, intensity, gx, gy, rainChar, seed)` and pass `this.material[i]` and `this.churnPhase[i]` from the render loop.

- [ ] **Step 5: Render dense tiles with material-specific contrast**

Before tier selection, apply:

```javascript
const mat = this.material[i];
if (this.theme.name === 'wintermute') {
  if (mat === MATERIAL.SEAM) b *= 0.5;
  if (mat === MATERIAL.APERTURE) b = Math.min(b, 0.04);
  if (mat === MATERIAL.MACHINE) b = Math.min(1.25, b + dyn.energy * 0.18);
}
```

Keep `drawImage` as the only per-cell drawing operation. Do not create gradients, arrays, or objects inside the cell loops.

- [ ] **Step 6: Replace rotating ring arcs with the approved broken halo**

Change the signature to `_drawRing(p, dyn, state, over, breach = 0)` and use `ringSegments(t, this.reducedMotion, breach)`. Draw a dim under-pass at `R * 0.08` and `R * 0.025`. Draw each bright segment with a 2.4 pixel white-cyan core and a 14 pixel shadow blur on high and medium quality. Keep the large gap on the right and remove the full-circle under-pass for wintermute. Keep the existing ring behavior for codefall.

Use this arc loop in both wintermute passes:

```javascript
for (const arc of ringSegments(t, this.reducedMotion, breach)) {
  ctx.beginPath();
  ctx.arc(cx, cy, R, arc.start, arc.end);
  ctx.stroke();
}
```

- [ ] **Step 7: Run tests and perform a stable-frame smoke check**

Run: `npm test`

Expected: 13 tests pass.

Run `python3 -m http.server 8000`, load `http://localhost:8000/?theme=wintermute`, and verify:

- angular human outline
- dense tile coverage across forehead and cheeks
- black open mouth during speech
- tight eye glow
- right-side halo gap

- [ ] **Step 8: Commit**

```bash
git add src/face/renderer.js test/renderer-helpers.test.js
git commit -m "feat: render wintermute tile apparition"
```

---

### Task 5: Integrate possession events and machine apertures

**Files:**
- Modify: `src/face/renderer.js:31-53,183-369`
- Modify: `test/renderer-helpers.test.js`

**Interfaces:**
- Consumes: `PossessionController.update` and `rowOffset`.
- Stores the current snapshot in `this.possession`.
- Passes breach intensity to `_drawRing` and debris emission.

- [ ] **Step 1: Add a failing displacement-bound test**

Append to `test/renderer-helpers.test.js`:

```javascript
test('overlapping bands cannot shift more than twelve cells', () => {
  assert.equal(rowOffset(5, { active: true, envelope: 1, bands: [
    { start: 2, height: 8, offset: 9 },
    { start: 4, height: 3, offset: 9 },
  ] }), 12);
});
```

- [ ] **Step 2: Run the bound test and confirm it fails**

Run: `node --test --test-name-pattern="twelve cells" test/*.test.js`

Expected: FAIL with actual value `18`.

- [ ] **Step 3: Clamp row displacement**

Change the return in `rowOffset`:

```javascript
return Math.max(-12, Math.min(12, Math.round(offset)));
```

- [ ] **Step 4: Add possession state to the renderer**

Import `PossessionController`. In the constructor add:

```javascript
this.possessionController = new PossessionController();
this.possession = {
  active: false, envelope: 0, bands: [], aperture: null, haloDrop: 0,
};
```

In `resize`, after `model.setGrid`, call `this.possessionController.reset(this._time)`.

In `render`, before the face cell loop:

```javascript
const possessionIntensity = Math.min(
  1.4,
  0.65 + p.tearForce * 0.35 + (state.mode === 'thinking' ? 0.2 : 0)
    + (state.mode === 'speaking' ? dyn.energy * 0.25 : 0),
);
this.possession = this.possessionController.update(this._time, {
  rows,
  intensity: possessionIntensity,
  reducedMotion: this.reducedMotion,
});
```

- [ ] **Step 5: Displace selected cell rows**

Calculate once per row:

```javascript
const glitchCells = rowOffset(r, this.possession);
const glitchX = glitchCells * this.cellW;
```

Add `glitchX` to the destination x coordinate in the cell `drawImage` call. Do not displace `REGION.VOID` cells. During a breach, redraw eye and mouth cells from displaced bands once with `globalAlpha = 0.3 * envelope` and the opposite x offset to create the duplicate feature.

- [ ] **Step 6: Draw the temporary aperture and interrupt the halo**

Add `_drawPossessionAperture(p, dyn)`. Convert the normalized `aperture.side`, `aperture.y`, and `aperture.radius` to model space. Draw:

1. a black filled circle
2. two thin concentric cyan rings
3. four radial ticks
4. six bright machine glyphs around the rim

Scale alpha by `this.possession.envelope`. Call the method after face tiles and before eye glow. Pass `this.possession.haloDrop` to `_drawRing` so the main gap widens during a breach.

Remove the old `_tear` and `_tearTimer` scheduler and canvas self-copy block. The possession controller replaces it.

- [ ] **Step 7: Run tests and force a browser breach**

Run: `npm test`

Expected: 14 tests pass.

For the browser smoke check, set the controller's first `nextAt` to `1` in DevTools, then verify:

- only selected face rows move
- at least half the face remains anchored
- the aperture appears inside the face
- eye or mouth duplication lasts less than 650 milliseconds
- the halo gap widens without a full-screen flash
- reduced-motion produces no displacement

- [ ] **Step 8: Commit**

```bash
git add src/face/renderer.js test/renderer-helpers.test.js
git commit -m "feat: expose machinery during possession"
```

---

### Task 6: Tune disintegration, quality tiers, and defaults

**Files:**
- Modify: `src/face/renderer.js:25-29,308-309,420-460`
- Modify: `src/config.js:59-67`
- Modify: `README.md`
- Create: `test/config.test.js`
- Modify: `test/renderer-helpers.test.js`

**Interfaces:**
- Produces: `debrisLimit(quality)`.
- Uses `this.possession.envelope` to increase debris emission.
- Keeps `resolveConfig({ face: { theme: 'codefall' } })` as the legacy override.

- [ ] **Step 1: Write failing configuration and quality tests**

Create `test/config.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';

test('wintermute is the default face theme', () => {
  assert.equal(resolveConfig().face.theme, 'wintermute');
});

test('codefall remains selectable', () => {
  assert.equal(resolveConfig({ face: { theme: 'codefall' } }).face.theme, 'codefall');
});
```

Append to `test/renderer-helpers.test.js`:

```javascript
import { debrisLimit } from '../src/face/renderer.js';

test('quality tiers cap debris', () => {
  assert.deepEqual(
    ['high', 'medium', 'low'].map(debrisLimit),
    [120, 72, 36],
  );
});
```

- [ ] **Step 2: Run tests and confirm failures**

Run: `node --test --test-name-pattern="default face|selectable|cap debris" test/*.test.js`

Expected: default theme reports `codefall` and `debrisLimit` is missing.

- [ ] **Step 3: Change the default and add quality limits**

In `src/config.js` set:

```javascript
theme: 'wintermute',
```

Add above `CodefallRenderer`:

```javascript
export function debrisLimit(quality) {
  return quality === 'low' ? 36 : quality === 'medium' ? 72 : 120;
}
```

Store `this.quality = this.detectQuality()` in `resize` and use it for `QUALITY` and debris limits.

- [ ] **Step 4: Concentrate disintegration below the jaw**

Change the debris accumulator and cap:

```javascript
const breach = this.possession?.envelope || 0;
const cap = debrisLimit(this.quality);
this._debrisAcc += dt * (
  4 + p.churn * 16 + (1 - dyn.coherence) * 58 + breach * 90
);
```

Filter source cells to the lower 55 percent of `_edgeCells` for normal emission. During boot or possession, allow all lower-face edge cells. Spawn with `size` between `0.55` and `1.35`, sideways velocity between `-14` and `14` pixels per second, and a downward velocity between `4` and `24` pixels per second. Low quality emits one particle per accumulator step; high quality may emit two during a breach.

- [ ] **Step 5: Document defaults and controls**

Update `README.md` to state:

````markdown
### Face themes

The default `wintermute` theme renders a cold voxel apparition with a broken
halo, tile disintegration, and short possession glitches. Select the original
green treatment with:

```js
window.CODEFALL_CONFIG = {
  face: { theme: 'codefall' },
};
```

Codefall Face respects `prefers-reduced-motion` by removing slice displacement,
feature duplication, rapid halo interruptions, and animated debris bursts.
````

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: 17 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/face/renderer.js src/config.js README.md test/config.test.js test/renderer-helpers.test.js
git commit -m "feat: finish wintermute face treatment"
```

---

### Task 7: Run visual and regression verification

**Files:**
- Modify if verification finds a defect: `src/face/face-model.js`, `src/face/renderer.js`, `src/face/glyphs.js`, or `styles.css`
- Update: `docs/superpowers/plans/2026-07-12-cyberpunk-voxel-face.md` checkbox state

**Interfaces:**
- Consumes the complete face renderer.
- Produces verified screenshots for review; do not commit the user's reference images.

- [ ] **Step 1: Run the automated suite**

Run: `npm test`

Expected: 17 tests pass with zero failures.

- [ ] **Step 2: Check syntax for browser modules**

Run:

```bash
node --check src/face/renderer.js
node --check src/face/face-model.js
node --check src/face/glyphs.js
node --check src/face/possession.js
```

Expected: each command exits with status 0 and prints no syntax error.

- [ ] **Step 3: Verify stable states**

Run `python3 -m http.server 8000` and open `http://localhost:8000/?theme=wintermute`. At desktop and narrow mobile sizes, capture:

- neutral idle after boot
- blink with centered gaze
- speaking with a wide mouth
- thinking state
- one strong emotion

Confirm the tile field describes the forehead, eyes, nose, cheeks, lips, and jaw. Confirm the halo has a right-side gap and remains brighter than the face.

- [ ] **Step 4: Verify dynamic states**

Capture one possession event and one low-coherence frame. Confirm:

- selected rows move and the rest stay anchored
- a black aperture and machine rim appear
- the mouth becomes a dark cavity during speech
- jaw and neck tiles fall into the lower data field
- no event lasts longer than 650 milliseconds

- [ ] **Step 5: Verify compatibility**

Check:

- `?theme=codefall` retains the green glyph treatment
- reduced-motion removes displacement, duplicates, flashing, and debris bursts
- high, medium, and low quality retain the human silhouette
- resize during idle and possession does not throw or leave stale bands
- voice playback, lip sync, emotion changes, blink, gaze, and boot assembly work

- [ ] **Step 6: Fix any observed defect and rerun the relevant check**

Keep fixes within the approved design. Add a regression assertion to the closest test file for any geometry, scheduling, configuration, or bound defect.

- [ ] **Step 7: Commit verification fixes**

If Step 6 changed files:

```bash
git add src/face/face-model.js src/face/renderer.js src/face/glyphs.js src/face/possession.js test/face-model.test.js test/renderer-helpers.test.js test/glyphs.test.js test/possession.test.js styles.css
git commit -m "fix: polish cyberpunk face rendering"
```

If Step 6 changed no files, record the successful commands and captured states in the task handoff without creating an empty commit.
