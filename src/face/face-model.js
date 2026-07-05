/**
 * Face Model — procedural facial topology as scalar fields.
 *
 * The face is never drawn as an image. Each frame this model evaluates,
 * per grid cell, a signed-distance-like head function (skull ellipse +
 * angular jaw wedge) and feature fields (brows, eyes, nose, mouth,
 * cheekbones) into three buffers:
 *
 *   sdf    — head distance field (renderer derives contour direction
 *            from its gradient, so the jawline is literally drawn with
 *            /, |, \ and — strokes)
 *   bright — 0..~1.4 luminance per cell (>1 blooms)
 *   region — which anatomy owns the cell (drives glyph vocabulary)
 *
 * Emotion parameters deform the topology itself: jawSharp changes the
 * jaw taper exponent, browAngle rotates the brow segments, mouthCurve
 * bends the lip line, asym desynchronizes the two sides. Speech input
 * opens the mouth, drops the chin and injects turbulence.
 */

import { REGION } from './glyphs.js';

export class FaceModel {
  constructor() {
    this.grid = null;
    this.u = null; // per-col normalized x
    this.v = null; // per-row normalized y
    this.noise = null; // static per-cell hash noise, rebuilt on resize
  }

  setGrid(grid) {
    this.grid = grid;
    const { cols, rows, cellW, cellH, width, height } = grid;
    const cx = width / 2;
    const cy = height * 0.44;
    // Uniform scale keeps facial proportions on any aspect ratio.
    const scale = Math.min(height * 0.40, width * 0.50);
    this.scale = scale;
    this.cx = cx;
    this.cy = cy;

    this.u = new Float32Array(cols);
    this.v = new Float32Array(rows);
    for (let c = 0; c < cols; c++) this.u[c] = (c * cellW + cellW / 2 - cx) / scale;
    for (let r = 0; r < rows; r++) this.v[r] = (r * cellH + cellH / 2 - cy) / scale;

    const n = cols * rows;
    this.noise = new Float32Array(n);
    let seed = 1337;
    for (let i = 0; i < n; i++) {
      // xorshift — deterministic texture, no per-frame allocation
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      this.noise[i] = ((seed >>> 0) % 1000) / 1000;
    }
  }

  /** Screen-space eye centers (for the renderer's glow pass). */
  eyePositions(p, dyn) {
    const out = [];
    for (const s of [-1, 1]) {
      out.push({
        x: this.cx + s * 0.28 * this.scale + dyn.gazeX * 0.02 * this.scale,
        y: this.cy + (-0.16 + dyn.gazeY * 0.02) * this.scale,
        r: 0.13 * this.scale * p.eyeWidth,
        glow: p.eyeGlow * dyn.blink,
      });
    }
    return out;
  }

  /** Mouth center in screen space (for speech turbulence focus). */
  mouthPosition() {
    return { x: this.cx, y: this.cy + 0.55 * this.scale };
  }

  /**
   * Evaluate the whole face into the buffers.
   * p   = blended emotion params, dyn = per-frame dynamics:
   * { mouthOpen, mouthWide, tension, energy, blink, gazeX, gazeY,
   *   coherence, swayX, swayY, t }
   */
  fill(bright, region, sdf, p, dyn) {
    const { cols, rows } = this.grid;
    const U = this.u, V = this.v, N = this.noise;
    const t = dyn.t;
    const coh = dyn.coherence;
    const scatter = (1 - coh) * 0.45;
    const lum = p.luminance * (0.9 + 0.1 * coh);

    // ---- head shape parameters -------------------------------------
    const skx = 0.70, sky = 0.62, skyc = -0.32; // skull ellipse
    const vCheek = -0.15, vCorner = 0.46;
    const vChin = 0.96 + dyn.mouthOpen * 0.05; // jaw drops as mouth opens
    const wCheek = 0.66;
    const wCorner = 0.48 + 0.10 * p.jawSharp; // sharper = squarer
    const wChin = 0.17;
    const taperPow = 1.3 + 1.1 * p.jawSharp; // higher = harder jaw angle

    // ---- feature parameters ----------------------------------------
    const browV = -0.36 - p.browHeight * 0.10;
    const browThick = 0.048;
    const eyeCY = -0.16;
    const eyeRX = 0.125 * p.eyeWidth;
    const asymT = Math.sin(t * 2.7) * p.asym; // slow left/right desync

    const open = dyn.mouthOpen;
    const vM = 0.55 + open * 0.03;
    const halfW = Math.max(0.06, 0.24 * p.mouthWidth * (1 + dyn.mouthWide * 0.25));
    const lipT = 0.032;
    const lipBright = 0.9 + 0.4 * (p.mouthTension * 0.6 + dyn.tension * 0.4);

    let i = 0;
    for (let r = 0; r < rows; r++) {
      const v0 = V[r] + dyn.swayY;
      for (let c = 0; c < cols; c++, i++) {
        // Coherence scatter: at low coherence the face samples "wrong"
        // coordinates, so features dissolve back into the stream.
        const nz = N[i];
        const u0 = U[c] + dyn.swayX + (nz - 0.5) * scatter;
        const v1 = v0 + (N[(i * 7 + 13) % N.length] - 0.5) * scatter;

        // ---- head SDF -----------------------------------------------
        const dx = u0 / skx, dy = (v1 - skyc) / sky;
        let d = Math.sqrt(dx * dx + dy * dy) - 1; // skull

        if (v1 > vCheek) {
          let w;
          if (v1 < vCorner) {
            w = wCheek + ((v1 - vCheek) / (vCorner - vCheek)) * (wCorner - wCheek);
          } else {
            const f = Math.min(1, (v1 - vCorner) / (vChin - vCorner));
            w = wCorner + Math.pow(f, taperPow) * (wChin - wCorner);
          }
          const dJaw = Math.max((Math.abs(u0) - w) / 0.35, (v1 - vChin) / 0.18);
          d = Math.min(d, dJaw);
        }

        sdf[i] = d;

        if (d > 0.06) { // outside the head — background rain territory
          bright[i] = 0;
          region[i] = REGION.VOID;
          continue;
        }

        // ---- contour band -------------------------------------------
        if (d > -0.045) {
          const jawPop = v1 > 0.1 ? 0.35 * p.jawSharp : 0.12;
          bright[i] = (0.6 + jawPop) * lum * coh;
          region[i] = REGION.EDGE;
          continue;
        }

        // ---- interior base ------------------------------------------
        let b = 0.10 + nz * 0.06 + Math.sin(t * 0.7 + nz * 9) * 0.02;
        let reg = REGION.FACE;
        const au = Math.abs(u0);
        const s = u0 < 0 ? -1 : 1;

        // Forehead sheen / cheekbones / chin pad — facial planes as density
        const fh = u0 * u0 / 0.09 + (v1 + 0.55) * (v1 + 0.55) / 0.06;
        if (fh < 1) b += 0.06 * (1 - fh);
        const cbx = au - 0.42, cby = v1 - 0.02;
        const cb = (cbx * cbx + cby * cby) / (0.17 * 0.17);
        if (cb < 1) b += 0.15 * (1 - cb);
        const ch = (u0 * u0 + (v1 - 0.80) * (v1 - 0.80)) / (0.12 * 0.12);
        if (ch < 1) b += 0.11 * (1 - ch);

        // ---- brows ---------------------------------------------------
        if (v1 > browV - 0.14 && v1 < browV + 0.16 && au > 0.06 && au < 0.48) {
          const innerY = browV - p.browAngle * 0.14 + s * p.asym * 0.05;
          const outerY = browV + p.browAngle * 0.11 - s * p.asym * 0.03;
          const fx = (au - 0.11) / 0.33; // 0 at inner end, 1 at outer
          if (fx >= 0 && fx <= 1) {
            const by = innerY + (outerY - innerY) * fx;
            const dist = Math.abs(v1 - by);
            if (dist < browThick) {
              b = Math.max(b, 0.95 * (1 - dist / browThick) + 0.25);
              reg = REGION.BROW;
            }
          }
        }

        // ---- eyes ----------------------------------------------------
        const eyeOpenSide =
          p.eyeOpen * dyn.blink * (1 + s * asymT * 0.25);
        const eyeRY = Math.max(0.012, 0.085 * eyeOpenSide);
        const ex = (u0 - s * 0.28 - dyn.gazeX * 0.02) / eyeRX;
        const ey = (v1 - eyeCY - dyn.gazeY * 0.02) / eyeRY;
        const er = ex * ex + ey * ey;
        if (er < 1) {
          b = er < 0.35 ? 0.95 * p.eyeGlow : 0.75 * p.eyeGlow;
          reg = REGION.EYE;
        } else if (er < 2.6) {
          b -= 0.06; // socket shadow
        }

        // ---- nose ----------------------------------------------------
        if (reg === REGION.FACE) {
          if (au < 0.028 && v1 > -0.06 && v1 < 0.26) {
            b = Math.max(b, 0.34);
            reg = REGION.NOSE;
          } else if (v1 > 0.24 && v1 < 0.31 && au > 0.04 && au < 0.10) {
            b = Math.max(b, 0.4);
            reg = REGION.NOSE;
          }
        }

        // ---- mouth ---------------------------------------------------
        if (reg === REGION.FACE && au < halfW + 0.05 && v1 > vM - 0.22 && v1 < vM + 0.24) {
          const xn = Math.min(1, au / halfW);
          const mid = vM - p.mouthCurve * 0.12 * (xn * xn - 0.35);
          const yU = mid - open * 0.085;
          const yL = mid + open * 0.115;
          if (au <= halfW) {
            if (open < 0.25 && Math.abs(v1 - mid) < 0.014) {
              // Closed mouth: a dark labial crease between bright lips —
              // the slit is what makes the mouth legible at glyph scale.
              b = 0.05;
              reg = REGION.MOUTH_INNER;
            } else if (Math.abs(v1 - yU) < lipT || Math.abs(v1 - yL) < lipT) {
              b = Math.max(b, lipBright);
              reg = REGION.MOUTH;
            } else if (v1 > yU && v1 < yL) {
              // Inner mouth: dark void that boils with speech energy
              b = 0.18 + dyn.energy * (0.45 + nz * 0.5);
              reg = REGION.MOUTH_INNER;
            }
          }
          // Speech turbulence radiates around the mouth region
          if (dyn.energy > 0.02 && reg === REGION.FACE) {
            const mr = (au * au + (v1 - vM) * (v1 - vM)) / (0.3 * 0.3);
            if (mr < 1) b += dyn.energy * 0.25 * (1 - mr) * nz;
          }
        }

        bright[i] = b * lum * (reg === REGION.EYE ? 1 : coh * 0.85 + 0.15);
        region[i] = reg;
      }
    }
  }
}
