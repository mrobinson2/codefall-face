/**
 * Codefall Renderer — draws the character field to a single 2D canvas.
 *
 * Performance model (targets 60fps on iPhone):
 *  - The whole charset is pre-rendered once into an offscreen glyph
 *    atlas at TIERS brightness levels; every cell is then a single
 *    drawImage, never fillText.
 *  - Simulation resolution (grid cells) is decoupled from display
 *    resolution (devicePixelRatio-scaled canvas) via quality tiers.
 *  - Phosphor persistence comes free: instead of clearing, each frame
 *    fades the previous one with a translucent black fill.
 *  - Possession glitches offset selected grid rows while leaving the
 *    background and most of the face anchored.
 *
 * Reduced motion: rain freezes to a slow drip, churn and glitch stop,
 * and the fade is replaced by a full clear (no trails).
 */

import {
  ATLAS_CHARS, CHAR_INDEX, TIERS, REGION,
  RAMP, RAIN, EDGE, EYE, MOUTH, BLOCKS, DEBRIS, MACHINE,
  MATERIAL, THEMES, makeTiers, tierFor, wintermuteGlyphFor,
} from './glyphs.js';
import { PossessionController } from './possession.js';

const QUALITY = {
  high: { cell: 11 },
  medium: { cell: 14 },
  low: { cell: 17 },
};

export function ringSegments(time, reducedMotion, breach = 0) {
  const drift = reducedMotion ? 0 : Math.sin(time * 0.08) * 0.035;
  const rightGap = Math.PI * (0.78 + breach * 0.22);
  const secondaryBreak = Math.PI * 0.09;
  const secondaryCenter = Math.PI * 1.425;
  return [
    {
      start: rightGap * 0.5 + drift,
      end: secondaryCenter - secondaryBreak * 0.5 + drift,
    },
    {
      start: secondaryCenter + secondaryBreak * 0.5 + drift,
      end: Math.PI * 2 - rightGap * 0.5 + drift,
    },
  ];
}

export function codefallRingSpans(breach = 0) {
  const clamped = Math.max(0, Math.min(1, breach));
  return [
    Math.PI * (1.62 - clamped * 0.36),
    Math.PI * (0.4 - clamped * 0.16),
  ];
}

export function apertureHardwareStroke(alpha) {
  return `hsla(190, 90%, 72%, ${alpha})`;
}

export function shouldRefreshWintermuteGlyph(dirty, themeName, reg) {
  return dirty && themeName === 'wintermute' && reg !== REGION.VOID;
}

export function rowOffset(row, possession) {
  if (!possession?.active) return 0;
  let offset = 0;
  for (const band of possession.bands) {
    if (row >= band.start && row < band.start + band.height) {
      offset += band.offset * possession.envelope;
    }
  }
  return Math.max(-12, Math.min(12, Math.round(offset)));
}

export function debrisLimit(quality) {
  return quality === 'low' ? 36 : quality === 'medium' ? 72 : 120;
}

export class CodefallRenderer {
  constructor(canvas, faceModel, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.model = faceModel;
    this.reducedMotion = !!opts.reducedMotion;
    this.qualityName = opts.quality || 'auto';
    this.theme = THEMES[opts.theme] || THEMES.codefall;
    this.hueShift = 0;
    this._debris = [];
    this._debrisAcc = 0;
    this._edgeCells = [];
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._time = 0;
    this._blink = 1;
    this._blinkTimer = 2 + Math.random() * 3;
    this.possessionController = new PossessionController();
    this.possession = {
      active: false, envelope: 0, bands: [], aperture: null, haloDrop: 0,
    };

    this.resize();
  }

  detectQuality() {
    if (this.qualityName !== 'auto') return this.qualityName;
    const small = Math.min(window.innerWidth, window.innerHeight) < 500;
    const dpr = window.devicePixelRatio || 1;
    if (small) return 'medium';
    return dpr > 1.5 ? 'high' : 'high';
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;

    this.quality = this.detectQuality();
    const q = QUALITY[this.quality];
    const font = q.cell;
    this.cellW = Math.round(font * 0.62 * 100) / 100;
    this.cellH = Math.round(font * 1.05 * 100) / 100;
    this.cols = Math.ceil(this.w / this.cellW);
    this.rows = Math.ceil(this.h / this.cellH);
    this.fontSize = font;

    const n = this.cols * this.rows;
    this.bright = new Float32Array(n);
    this.region = new Uint8Array(n);
    this.sdf = new Float32Array(n);
    this.material = new Uint8Array(n);
    this._wintermuteGlyphsDirty = this.theme.name === 'wintermute';
    this.glyph = new Uint16Array(n); // atlas index per cell
    this.churnPhase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.glyph[i] = (Math.random() * ATLAS_CHARS.length) | 0;
      this.churnPhase[i] = Math.random();
    }

    // Rain columns: position (cells), speed, trail length
    this.rain = [];
    for (let c = 0; c < this.cols; c++) {
      this.rain.push({
        y: Math.random() * this.rows * 2 - this.rows,
        speed: 6 + Math.random() * 14,
        len: 5 + Math.random() * 14,
        charSeed: (Math.random() * 997) | 0,
      });
    }

    this.model.setGrid({
      cols: this.cols, rows: this.rows,
      cellW: this.cellW, cellH: this.cellH,
      width: this.w, height: this.h,
    });
    this.possessionController.reset(this._time);

    this.buildAtlas(this.hueShift);
    // Reset to black so the fade pass has a clean base.
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setTheme(name) {
    this.theme = THEMES[name] || THEMES.codefall;
    this._wintermuteGlyphsDirty = this.theme.name === 'wintermute';
    this.buildAtlas(this.hueShift);
  }

  invalidateGeometry() {
    if (this.theme.name === 'wintermute') this._wintermuteGlyphsDirty = true;
  }

  buildAtlas(hueShift) {
    this.hueShift = hueShift;
    const tiers = makeTiers(this.theme.hue + hueShift * 0.6, this.theme.sat);
    const cw = Math.ceil(this.cellW * this.dpr);
    const chh = Math.ceil(this.cellH * this.dpr);
    const atlas = document.createElement('canvas');
    atlas.width = cw * ATLAS_CHARS.length;
    atlas.height = chh * TIERS;
    const a = atlas.getContext('2d');
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    a.font = `${this.fontSize * this.dpr}px "SF Mono", Menlo, Consolas, monospace`;
    for (let t = 0; t < TIERS; t++) {
      a.fillStyle = tiers[t];
      for (let g = 0; g < ATLAS_CHARS.length; g++) {
        a.fillText(ATLAS_CHARS[g], g * cw + cw / 2, t * chh + chh / 2);
      }
    }
    this.atlas = atlas;
    this.atlasCW = cw;
    this.atlasCH = chh;
  }

  /** Pick a glyph for a cell from its region's vocabulary. */
  pickGlyph(reg, material, intensity, gx, gy, rainChar, seed) {
    if (this.theme.name === 'wintermute' && reg !== REGION.VOID) {
      const char = wintermuteGlyphFor(material, intensity, seed);
      return CHAR_INDEX.get(char);
    }
    switch (reg) {
      case REGION.EDGE: {
        // Contour direction = perpendicular to the SDF gradient.
        const ang = Math.atan2(gy, gx) + Math.PI / 2;
        const bucket = ((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4;
        return CHAR_INDEX.get(EDGE[bucket]);
      }
      case REGION.EYE:
        return CHAR_INDEX.get(EYE[(intensity * EYE.length) | 0] ?? EYE[EYE.length - 1]);
      case REGION.MOUTH:
      case REGION.MOUTH_INNER:
        return CHAR_INDEX.get(MOUTH[(Math.random() * MOUTH.length) | 0]);
      case REGION.SHARD: {
        const bi = Math.min(BLOCKS.length - 1, (intensity * BLOCKS.length * 1.4) | 0);
        return CHAR_INDEX.get(BLOCKS[bi]);
      }
      case REGION.VOID:
        return CHAR_INDEX.get(rainChar);
      default: {
        // Face flesh: mix brightness-ramp with datastream characters,
        // so the face reads as *made of* code, not shaded with dots.
        // Blocky themes lean on voxel tiles for the mosaic-head look.
        if (this.theme.blocky && Math.random() < 0.55) {
          const bi = Math.min(BLOCKS.length - 1, (intensity * BLOCKS.length) | 0);
          return CHAR_INDEX.get(BLOCKS[bi]);
        }
        if (Math.random() < 0.2) {
          return CHAR_INDEX.get(RAIN[(Math.random() * RAIN.length) | 0]);
        }
        const i = Math.min(RAMP.length - 1, (intensity * RAMP.length) | 0);
        return CHAR_INDEX.get(RAMP[i]);
      }
    }
  }

  /**
   * Render one frame.
   * state = { params, dyn, mode } — see controller for shapes.
   */
  render(dt, state) {
    const { params: p, dyn } = state;
    const ctx = this.ctx;
    const { cols, rows } = this;
    this._time += dt;
    dyn.t = this._time;

    // ---- blink scheduler --------------------------------------------
    this._blinkTimer -= dt;
    if (this._blinkTimer <= 0) {
      this._blinkTimer = 1.8 + Math.random() * 4.2;
      this._blinkAt = this._time;
    }
    if (this._blinkAt != null) {
      const bt = (this._time - this._blinkAt) / 0.22;
      this._blink = bt >= 1 ? 1 : Math.abs(Math.cos(bt * Math.PI)); // close+open
      if (bt >= 1) this._blinkAt = null;
    }
    dyn.blink = this.reducedMotion ? 1 : this._blink;

    // ---- idle body language -----------------------------------------
    if (!this.reducedMotion) {
      dyn.swayX = Math.sin(this._time * 0.31) * 0.015 * p.swayAmp;
      dyn.swayY =
        Math.sin(this._time * 0.47) * 0.012 * p.swayAmp +
        Math.sin(this._time * 1.7) * 0.004 * p.breathAmp;
    } else {
      dyn.swayX = 0; dyn.swayY = 0;
    }

    // ---- simulation ---------------------------------------------------
    this.model.fill(this.bright, this.region, this.sdf, this.material, p, dyn);

    // ---- rebuild atlas if the emotion changed the hue ------------------
    if (Math.abs(p.hueShift - this.hueShift) > 4) this.buildAtlas(p.hueShift);

    // ---- fade pass (phosphor persistence) ------------------------------
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.reducedMotion) {
      ctx.fillStyle = '#000';
    } else {
      const fade = 0.22 + 0.2 * (1 - Math.min(1, p.regen));
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.6, fade).toFixed(3)})`;
    }
    ctx.fillRect(0, 0, this.w, this.h);

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

    // ---- halo ring, under-pass (glyphs draw over it, occluding) --------
    if (this.theme.ring > 0) {
      this._drawRing(p, dyn, state, false, this.possession.haloDrop);
    }

    // ---- rain update ----------------------------------------------------
    const rainMul = this.reducedMotion ? 0.06 : p.rainSpeed;
    for (const col of this.rain) {
      col.y += col.speed * rainMul * dt;
      if (col.y - col.len > rows) {
        col.y = -Math.random() * rows * 0.5;
        col.speed = 6 + Math.random() * 14;
        col.len = 5 + Math.random() * 14;
      }
    }

    // ---- draw the character field ---------------------------------------
    const churnBase =
      (this.reducedMotion ? 0.005 : 0.03 + p.churn * 0.25) +
      (state.mode === 'thinking' ? 0.1 : 0);
    const flick = this.reducedMotion ? 0 : p.flicker;

    const rainDim = this.theme.rainDim;
    this._edgeCells.length = 0;
    const duplicateAlpha = 0.3 * this.possession.envelope;

    let i = 0;
    for (let r = 0; r < rows; r++) {
      const glitchCells = rowOffset(r, this.possession);
      const glitchX = glitchCells * this.cellW;
      for (let c = 0; c < cols; c++, i++) {
        let b = this.bright[i];
        const reg = this.region[i];
        const mat = this.material[i];
        const col = this.rain[c];
        if (reg === REGION.EDGE) this._edgeCells.push(i);

        // Rain contribution
        const dHead = col.y - r;
        let inRain = false;
        if (dHead >= 0 && dHead < col.len) {
          const trail = 1 - dHead / col.len;
          if (reg === REGION.VOID) {
            b = Math.max(b, (dHead < 1 ? 0.9 : trail * 0.42) * p.rainDensity * rainDim);
            inRain = true;
          } else {
            // Rain passing *through* the face perturbs it
            b *= 0.85 + trail * 0.35;
            if (dHead < 1) b += 0.15;
          }
        }
        const forceGlyphRefresh = shouldRefreshWintermuteGlyph(
          this._wintermuteGlyphsDirty, this.theme.name, reg
        );
        const visible = b > 0.02;
        if (!visible && !forceGlyphRefresh) continue;

        // Flicker
        if (visible && flick && Math.random() < flick * 0.3) b *= 0.4;

        // Glyph churn: near rain heads, in turbulent regions, or randomly
        const churn =
          churnBase +
          (dHead >= 0 && dHead < 2 ? 0.8 : 0) +
          (reg === REGION.MOUTH_INNER ? dyn.energy * 0.5 : 0);
        if (forceGlyphRefresh || (visible && Math.random() < churn * dt * 12)) {
          let gx = 0, gy = 0;
          if (reg === REGION.EDGE) {
            const L = c > 0 ? this.sdf[i - 1] : this.sdf[i];
            const R = c < cols - 1 ? this.sdf[i + 1] : this.sdf[i];
            const T = r > 0 ? this.sdf[i - cols] : this.sdf[i];
            const B = r < rows - 1 ? this.sdf[i + cols] : this.sdf[i];
            gx = (R - L) / this.cellW * this.cellH; // aspect-correct
            gy = B - T;
          }
          const rainChar = RAIN[(col.charSeed + r) % RAIN.length];
          this.glyph[i] = this.pickGlyph(
            reg, mat, Math.max(0, Math.min(1, b)), gx, gy, rainChar, this.churnPhase[i]
          );
        }

        if (!visible) continue;

        if (this.theme.name === 'wintermute') {
          if (mat === MATERIAL.SEAM) b *= 0.5;
          if (mat === MATERIAL.APERTURE) b = Math.min(b, 0.04);
          if (mat === MATERIAL.MACHINE) b = Math.min(1.25, b + dyn.energy * 0.18);
        }

        const tier = tierFor(Math.min(1.399, b) / 1.4 + (inRain && dHead < 1 ? 0.3 : 0));
        ctx.drawImage(
          this.atlas,
          this.glyph[i] * this.atlasCW, tier * this.atlasCH,
          this.atlasCW, this.atlasCH,
          c * this.cellW + (reg === REGION.VOID ? 0 : glitchX),
          r * this.cellH, this.cellW, this.cellH
        );
        const duplicateFeature = glitchCells !== 0 && (
          reg === REGION.EYE || reg === REGION.MOUTH || reg === REGION.MOUTH_INNER
        );
        if (duplicateFeature) {
          ctx.globalAlpha = duplicateAlpha;
          ctx.drawImage(
            this.atlas,
            this.glyph[i] * this.atlasCW, tier * this.atlasCH,
            this.atlasCW, this.atlasCH,
            c * this.cellW - glitchX, r * this.cellH, this.cellW, this.cellH
          );
          ctx.globalAlpha = 1;
        }
      }
    }
    this._wintermuteGlyphsDirty = false;

    // ---- disintegration debris: the face crumbles off its lower edge ---
    this._updateDebris(dt, p, dyn, ctx, state.mode === 'booting');

    // ---- possession aperture: the machine beneath the face ------------
    this._drawPossessionAperture(p, dyn);

    // ---- eye glow pass -----------------------------------------------
    const glowHue = this.theme.hue + p.hueShift;
    const glowSat = Math.round(this.theme.sat * 100);
    if (dyn.blink > 0.15) {
      ctx.globalCompositeOperation = 'lighter';
      for (const eye of this.model.eyePositions(p, dyn)) {
        const rad = eye.r * 1.5;
        const g = ctx.createRadialGradient(eye.x, eye.y, 0, eye.x, eye.y, rad);
        const a = Math.min(0.3, 0.13 * eye.glow * dyn.coherence);
        g.addColorStop(0, `hsla(${glowHue}, ${glowSat}%, 72%, ${a})`);
        g.addColorStop(1, `hsla(${glowHue}, ${glowSat}%, 50%, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(eye.x - rad, eye.y - rad, rad * 2, rad * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- halo ring, bright core over the glyphs -------------------------
    if (this.theme.ring > 0) {
      this._drawRing(p, dyn, state, true, this.possession.haloDrop);
    }

    // ---- fps accounting -------------------------------------------------
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsN / this._fpsAcc);
      this._fpsAcc = 0; this._fpsN = 0;
    }
  }

  /** Reveal a short-lived machine port beneath displaced face tiles. */
  _drawPossessionAperture(p, dyn) {
    const aperture = this.possession.aperture;
    const envelope = this.possession.envelope;
    if (!aperture || envelope <= 0) return;

    const ctx = this.ctx;
    const scale = this.model.scale;
    const x = this.model.cx + aperture.side * scale * 0.42;
    const y = this.model.cy + aperture.y * scale;
    const radius = aperture.radius * scale;
    const pulse = 0.8 + dyn.energy * 0.2;

    ctx.save();
    ctx.globalAlpha = envelope;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = apertureHardwareStroke(0.8 * pulse);
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 2; ring++) {
      ctx.beginPath();
      ctx.arc(x, y, radius * (1 + ring * 0.22), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let tick = 0; tick < 4; tick++) {
      const angle = tick * Math.PI * 0.5;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(x + cos * radius * 1.28, y + sin * radius * 1.28);
      ctx.lineTo(x + cos * radius * 1.58, y + sin * radius * 1.58);
      ctx.stroke();
    }

    const glyphRadius = radius * 1.72;
    const glyphW = this.cellW * 0.85;
    const glyphH = this.cellH * 0.85;
    for (let glyph = 0; glyph < 6; glyph++) {
      const angle = glyph * Math.PI / 3;
      const glyphIndex = CHAR_INDEX.get(MACHINE[glyph % MACHINE.length]);
      ctx.drawImage(
        this.atlas,
        glyphIndex * this.atlasCW, (TIERS - 1) * this.atlasCH,
        this.atlasCW, this.atlasCH,
        x + Math.cos(angle) * glyphRadius - glyphW * 0.5,
        y + Math.sin(angle) * glyphRadius - glyphH * 0.5,
        glyphW, glyphH,
      );
    }
    ctx.restore();
  }

  /**
   * The halo: a broken neon ring encircling the head (Wintermute's
   * portal). Under-pass lays a wide dim annulus the glyphs occlude;
   * over-pass strokes rotating bright arc segments that flicker and
   * surge with speech energy.
   */
  _drawRing(p, dyn, state, over, breach = 0) {
    const ctx = this.ctx;
    const cx = this.model.cx;
    const cy = this.model.cy + 0.02 * this.model.scale;
    // Fit the halo inside the stage even on short viewports.
    const R = Math.min(1.06 * this.model.scale, this.model.cy - 8);
    const t = this._time;
    const hue = this.theme.hue + p.hueShift;
    const sat = Math.round(this.theme.sat * 100);
    const energy = 0.55 + dyn.energy * 0.5 + (state.mode === 'speaking' ? 0.15 : 0);
    const strength = this.theme.ring * dyn.coherence * energy;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (this.theme.name === 'wintermute') {
      if (!over) {
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, 65%, ${(0.10 * strength).toFixed(3)})`;
        ctx.lineWidth = R * 0.08;
        for (const arc of ringSegments(t, this.reducedMotion, breach)) {
          ctx.beginPath();
          ctx.arc(cx, cy, R, arc.start, arc.end);
          ctx.stroke();
        }
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, 75%, ${(0.14 * strength).toFixed(3)})`;
        ctx.lineWidth = R * 0.025;
        for (const arc of ringSegments(t, this.reducedMotion, breach)) {
          ctx.beginPath();
          ctx.arc(cx, cy, R, arc.start, arc.end);
          ctx.stroke();
        }
      } else {
        const flick = this.reducedMotion ? 1 : 0.82 + Math.random() * 0.18;
        if (this.quality !== 'low') {
          ctx.shadowBlur = 14;
          ctx.shadowColor = `hsla(${hue}, ${sat}%, 70%, 0.8)`;
        }
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, 88%, ${(0.55 * strength * flick).toFixed(3)})`;
        ctx.lineWidth = 2.4;
        for (const arc of ringSegments(t, this.reducedMotion, breach)) {
          ctx.beginPath();
          ctx.arc(cx, cy, R, arc.start, arc.end);
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }
    if (!over) {
      // Wide soft annulus behind everything.
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 65%, ${(0.10 * strength).toFixed(3)})`;
      ctx.lineWidth = R * 0.10;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 75%, ${(0.14 * strength).toFixed(3)})`;
      ctx.lineWidth = R * 0.035;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    } else {
      // Thin bright cores: one long rotating arc, one short counter-arc.
      const flick = this.reducedMotion ? 1 : 0.82 + Math.random() * 0.18;
      const useBlur = this.quality !== 'low' && !this.reducedMotion;
      const [longSpan, shortSpan] = codefallRingSpans(breach);
      if (useBlur) {
        ctx.shadowBlur = 16;
        ctx.shadowColor = `hsla(${hue}, ${sat}%, 70%, 0.8)`;
      }
      const a0 = this.reducedMotion ? -Math.PI / 2 : t * 0.22;
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 82%, ${(0.55 * strength * flick).toFixed(3)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + longSpan); ctx.stroke();

      const b0 = -t * 0.13 + 2.1;
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 88%, ${(0.4 * strength * flick).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.012, b0, b0 + shortSpan); ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Disintegration: glyph tiles detach from the lower face contour and
   * fall away, fading. Spawn rate rises with churn and with coherence
   * loss, so interruptions visibly shed pieces of the face.
   */
  _updateDebris(dt, p, dyn, ctx, booting = false) {
    if (this.reducedMotion) return;
    const breach = this.possession?.envelope || 0;
    const cap = debrisLimit(this.quality);
    this._debrisAcc += dt * (
      4 + p.churn * 16 + (1 - dyn.coherence) * 58 + breach * 90
    );
    while (this._debrisAcc >= 1 && this._debris.length < cap && this._edgeCells.length) {
      this._debrisAcc -= 1;
      const sourceStart = booting || this.possession?.active
        ? 0
        : Math.floor(this._edgeCells.length * 0.45);
      const sourceCount = this._edgeCells.length - sourceStart;
      const spawnCount = this.quality === 'high' && breach > 0 ? 2 : 1;
      for (let spawned = 0; spawned < spawnCount && this._debris.length < cap; spawned++) {
        const idx = this._edgeCells[sourceStart + ((Math.random() * sourceCount) | 0)];
        const c = idx % this.cols, r = (idx / this.cols) | 0;
        this._debris.push({
          x: c * this.cellW, y: r * this.cellH,
          vx: -14 + Math.random() * 28,
          vy: 4 + Math.random() * 20,
          life: 1, decay: 0.4 + Math.random() * 0.5,
          gi: CHAR_INDEX.get(DEBRIS[(Math.random() * DEBRIS.length) | 0]),
          size: 0.55 + Math.random() * 0.8,
        });
      }
    }
    if (!this._debris.length) return;
    for (let k = this._debris.length - 1; k >= 0; k--) {
      const d = this._debris[k];
      d.life -= d.decay * dt;
      if (d.life <= 0) { this._debris.splice(k, 1); continue; }
      d.vy += 26 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const tier = Math.min(TIERS - 1, 1 + ((d.life * 3) | 0));
      ctx.globalAlpha = Math.min(0.8, d.life);
      ctx.drawImage(
        this.atlas,
        d.gi * this.atlasCW, tier * this.atlasCH, this.atlasCW, this.atlasCH,
        d.x, d.y, this.cellW * d.size, this.cellH * d.size
      );
    }
    ctx.globalAlpha = 1;
  }
}
