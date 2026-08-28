/**
 * Face Model — procedural facial topology as scalar fields.
 *
 * The face is never drawn as an image. Each frame this model evaluates,
 * per grid cell, a signed-distance-like head function (rounded crown +
 * chiseled piecewise silhouette) and feature fields (brows, eyes, nose, mouth,
 * cheekbones) into four buffers:
 *
 *   sdf    — head distance field (renderer derives contour direction
 *            from its gradient, so the jawline is literally drawn with
 *            /, |, \ and — strokes)
 *   bright — 0..~1.4 luminance per cell (>1 blooms)
 *   region — which anatomy owns the cell (drives glyph vocabulary)
 *   material — which tile vocabulary owns the cell
 *
 * Emotion parameters deform the topology itself: jawSharp changes the
 * jaw break width, browAngle rotates the brow segments, mouthCurve
 * bends the lip line, asym desynchronizes the two sides. Speech input
 * opens the mouth, drops the chin and injects turbulence.
 */

import { MATERIAL, REGION } from './glyphs.js';

export function headHalfWidth(v, mouthOpen = 0, jawSharp = 0.5) {
  const templeTopV = -0.82, templeTopW = 0.42;
  const templeV = -0.55, templeW = 0.52;
  const cheekV = -0.08, cheekW = 0.62;
  const jawV = 0.38, jawW = 0.48 + jawSharp * 0.035;
  const chinBreakV = 0.68, chinBreakW = 0.34;
  const chinV = 1.0 + mouthOpen * 0.05, chinW = 0.09;

  if (v <= templeTopV) return templeTopW;
  if (v <= templeV) {
    const t = (v - templeTopV) / (templeV - templeTopV);
    return templeTopW + (templeW - templeTopW) * t;
  }
  if (v <= cheekV) {
    const t = (v - templeV) / (cheekV - templeV);
    return templeW + (cheekW - templeW) * t;
  }
  if (v <= jawV) {
    const t = (v - cheekV) / (jawV - cheekV);
    return cheekW + (jawW - cheekW) * t;
  }
  if (v <= chinBreakV) {
    const t = (v - jawV) / (chinBreakV - jawV);
    return jawW + (chinBreakW - jawW) * t;
  }
  if (v <= chinV) {
    const t = (v - chinBreakV) / (chinV - chinBreakV);
    return chinBreakW + (chinW - chinBreakW) * t;
  }
  return chinW;
}

export function smoothHeadDistance(u, v, mouthOpen = 0, jawSharp = 0.5) {
  const skull = Math.hypot(u / 0.62, (v + 0.32) / 0.64) - 1;
  if (v <= -0.15) return skull;
  const corner = 0.42 + 0.08 * jawSharp;
  let width;
  if (v < 0.44) {
    const t = (v + 0.15) / 0.59;
    width = 0.60 + t * (corner - 0.60);
  } else {
    const chin = 1.0 + mouthOpen * 0.05;
    const t = Math.max(0, Math.min(1, (v - 0.44) / (chin - 0.44)));
    width = corner + Math.pow(t, 1.3 + 1.1 * jawSharp) * (0.08 - corner);
  }
  const chin = 1.0 + mouthOpen * 0.05;
  const jaw = Math.max((Math.abs(u) - width) / 0.35, (v - chin) / 0.18);
  return Math.min(skull, jaw);
}

export function classifyFaceMaterial(u, v, noise, region) {
  if (region === REGION.EYE || region === REGION.MOUTH || region === REGION.NOSE ||
      region === REGION.BROW_RIDGE || region === REGION.NOSE_PLANE) {
    return MATERIAL.FINE;
  }
  if (region === REGION.MOUTH_INNER) return MATERIAL.MACHINE;
  if (region === REGION.NOSTRIL || region === REGION.ORBIT) return MATERIAL.CAVITY;
  if (region === REGION.JAW_HINGE) return MATERIAL.ACTUATOR;
  if (region === REGION.NECK_TENDON) return MATERIAL.CONDUIT;
  if (region === REGION.CHIN_PLATE || region === REGION.CHEEK_PLANE) return MATERIAL.PLATE;
  if (region === REGION.TEMPLE_PORT) return MATERIAL.APERTURE;
  const port = u > 0.43 && u < 0.56 && v > 0.02 && v < 0.22;
  if (port) return MATERIAL.APERTURE;
  const seam = Math.abs(Math.abs(u) - (0.24 + (v + 0.2) * 0.24)) < 0.018;
  if (seam && v > -0.35 && v < 0.72) return MATERIAL.SEAM;
  return noise > 0.72 ? MATERIAL.FINE : MATERIAL.TILE;
}

export class FaceModel {
  constructor(geometry = 'chiseled') {
    this.geometry = geometry === 'smooth' ? 'smooth' : 'chiseled';
    this.grid = null;
    this.u = null; // per-col normalized x
    this.v = null; // per-row normalized y
    this.noise = null; // static per-cell hash noise, rebuilt on resize
    this._eyes = [
      { x: 0, y: 0, r: 0, glow: 0 },
      { x: 0, y: 0, r: 0, glow: 0 },
    ];
    this._mouth = { x: 0, y: 0 };
  }

  setGeometry(style) {
    if (style === 'chiseled' || style === 'smooth') this.geometry = style;
    return this.geometry;
  }

  setGrid(grid) {
    this.grid = grid;
    const { cols, rows, cellW, cellH, width, height } = grid;
    const cx = width / 2;
    const cy = height * 0.42;
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
    for (let index = 0; index < 2; index++) {
      const s = index === 0 ? -1 : 1;
      const eye = this._eyes[index];
      eye.x = this.cx + s * 0.26 * this.scale + dyn.gazeX * 0.02 * this.scale;
      eye.y = this.cy + (-0.16 + dyn.gazeY * 0.02) * this.scale;
      eye.r = 0.13 * this.scale * p.eyeWidth;
      eye.glow = p.eyeGlow * dyn.blink;
    }
    return this._eyes;
  }

  /** Mouth center in screen space (for speech turbulence focus). */
  mouthPosition() {
    this._mouth.x = this.cx;
    this._mouth.y = this.cy + 0.55 * this.scale;
    return this._mouth;
  }

  /**
   * Evaluate the whole face into the buffers.
   * p   = blended emotion params, dyn = per-frame dynamics:
   * { mouthOpen, mouthWide, tension, energy, blink, gazeX, gazeY,
   *   coherence, swayX, swayY, t }
   */
  fill(bright, region, sdf, material, p, dyn) {
    let depth = null;
    let substrate = null;
    if (bright?.brightness) {
      const buffers = bright;
      dyn = sdf;
      p = region;
      bright = buffers.brightness;
      region = buffers.region;
      sdf = buffers.distance;
      material = buffers.material;
      depth = buffers.depth;
      substrate = buffers.substrate;
    }
    const { cols, rows } = this.grid;
    const U = this.u, V = this.v, N = this.noise;
    const t = dyn.t;
    const coh = dyn.coherence;
    const scatter = (1 - coh) * 0.45;
    const lum = p.luminance * (0.9 + 0.1 * coh);

    // ---- feature parameters ----------------------------------------
    // Brows sit low, almost on the eyes — the hooded glare is what makes
    // the face read as predatory rather than friendly.
    const browV = -0.30 - p.browHeight * 0.10;
    const browThick = 0.048;
    const eyeCY = -0.16;
    const eyeRX = 0.135 * p.eyeWidth;
    const asymT = Math.sin(t * 2.7) * p.asym; // slow left/right desync

    const open = dyn.mouthOpen;
    const vM = 0.55 + open * 0.03;
    const halfW = Math.max(0.06, 0.22 * p.mouthWidth * (1 + dyn.mouthWide * 0.25));
    const lipT = 0.032;
    const lipBright = 0.9 + 0.4 * (p.mouthTension * 0.6 + dyn.tension * 0.4);

    let i = 0;
    for (let r = 0; r < rows; r++) {
      const v0 = V[r] + dyn.swayY;
      for (let c = 0; c < cols; c++, i++) {
        material[i] = MATERIAL.NONE;
        if (depth) depth[i] = 0;
        if (substrate) substrate[i] = 0;

        // Coherence scatter: at low coherence the face samples "wrong"
        // coordinates, so features dissolve back into the stream.
        const nz = N[i];
        const u0 = U[c] + dyn.swayX + (nz - 0.5) * scatter;
        const v1 = v0 + (N[(i * 7 + 13) % N.length] - 0.5) * scatter;

        // ---- head SDF -----------------------------------------------
        let d;
        if (this.geometry === 'smooth') {
          d = smoothHeadDistance(u0, v1, dyn.mouthOpen, p.jawSharp);
        } else {
          const vChin = 1.0 + dyn.mouthOpen * 0.05;
          const top = -0.86;
          const bottomDistance = (v1 - vChin) / 0.16;
          const halfWidth = headHalfWidth(v1, dyn.mouthOpen, p.jawSharp);
          const sideDistance = (Math.abs(u0) - halfWidth) / 0.28;
          d = Math.max(sideDistance, bottomDistance, (top - v1) / 0.16);
          const crown = Math.hypot(u0 / 0.48, (v1 + 0.6) / 0.32) - 1;
          if (v1 < -0.42) d = Math.min(d, crown);
        }

        sdf[i] = d;

        if (d > 0.06) { // outside the head
          const neckX = 0.16 + Math.max(0, v1 - 0.78) * 0.09;
          if (v1 > 0.82 && v1 < 1.38 && Math.abs(Math.abs(u0) - neckX) < 0.035) {
            bright[i] = (0.28 + nz * 0.2) * lum * coh;
            region[i] = REGION.NECK_TENDON;
            material[i] = MATERIAL.CONDUIT;
            if (depth) depth[i] = 0.35;
            if (substrate) substrate[i] = 0.92;
            continue;
          }
          // Fragmentation aura: the silhouette sheds static pixel
          // shards into the surrounding dark (denser near the edge).
          if (d < 0.5 && nz > 0.8) {
            bright[i] = (0.5 - d) * (0.35 + nz * 0.9) * lum * (0.5 + 0.5 * coh);
            region[i] = REGION.SHARD;
            material[i] = MATERIAL.LOOSE;
          } else {
            bright[i] = 0;
            region[i] = REGION.VOID;
          }
          continue;
        }

        // ---- contour band -------------------------------------------
        if (d > -0.045) {
          const jawPop = v1 > 0.1 ? 0.32 * p.jawSharp : 0.1;
          bright[i] = (0.68 + jawPop) * lum * coh;
          region[i] = REGION.EDGE;
          if (depth) depth[i] = 0.22;
          if (substrate) substrate[i] = Math.min(1, 0.42 + nz * 0.32);
          continue;
        }

        // ---- interior base: near-black — only the line-work glows ----
        let b = 0.035 + nz * 0.03 + Math.sin(t * 0.7 + nz * 9) * 0.012;
        let reg = REGION.FACE;
        const au = Math.abs(u0);
        const s = u0 < 0 ? -1 : 1;

        // Faint facial planes — kept dim so the line-work dominates
        const fh = u0 * u0 / 0.09 + (v1 + 0.55) * (v1 + 0.55) / 0.06;
        if (fh < 1) b += 0.02 * (1 - fh);
        const ch = (u0 * u0 + (v1 - 0.80) * (v1 - 0.80)) / (0.12 * 0.12);
        if (ch < 1) b += 0.05 * (1 - ch);

        // Gaunt cheekbone: a thin light-line raking from the cheekbone
        // down toward the mouth corner (the edge that catches the glow).
        {
          const pax = au - 0.36, pay = v1 - 0.10;
          const bax = -0.14, bay = 0.30;
          let h = (pax * bax + pay * bay) / (bax * bax + bay * bay);
          h = h < 0 ? 0 : h > 1 ? 1 : h;
          const dxc = pax - bax * h, dyc = pay - bay * h;
          if (dxc * dxc + dyc * dyc < 0.022 * 0.022) b = Math.max(b, 0.42);
          if (dxc * dxc + dyc * dyc < 0.035 * 0.035) reg = REGION.CHEEK_PLANE;
        }

        // Forehead circuit traces — machine etchings under the skin.
        if (v1 < -0.42) {
          if (au < 0.012 && v1 > -0.78) b = Math.max(b, 0.38);
          if (au < 0.09 && (Math.abs(v1 + 0.62) < 0.012 || Math.abs(v1 + 0.50) < 0.012)) {
            b = Math.max(b, 0.3);
          }
        }

        // ---- brows: angular ridges sweeping up toward the temples ----
        if (v1 > browV - 0.18 && v1 < browV + 0.16 && au > 0.06 && au < 0.48) {
          const innerY = browV - p.browAngle * 0.14 + s * p.asym * 0.05;
          const outerY = browV - 0.055 + p.browAngle * 0.11 - s * p.asym * 0.03;
          const fx = (au - 0.11) / 0.33; // 0 at inner end, 1 at outer
          if (fx >= 0 && fx <= 1) {
            const by = innerY + (outerY - innerY) * fx;
            const dist = Math.abs(v1 - by);
            if (dist < browThick) {
              b = Math.max(b, 1.05 * (1 - dist / browThick) + 0.3);
              reg = REGION.BROW_RIDGE;
            } else if (v1 > by && v1 < by + 0.09) {
              b -= 0.09; // supraorbital shadow — the shelf that hoods the eyes
            }
          }
        }

        // ---- eyes ----------------------------------------------------
        const eyeOpenSide =
          p.eyeOpen * dyn.blink * (1 + s * asymT * 0.25);
        const eyeRY = Math.max(0.012, 0.075 * eyeOpenSide);
        const ex = (u0 - s * 0.26 - dyn.gazeX * 0.02) / eyeRX;
        let ey = (v1 - eyeCY - dyn.gazeY * 0.02) / eyeRY;
        ey += s * ex * -0.30; // almond shear: outer corners sweep up to the temples
        const er = ex * ex + ey * ey;
        if (er < 1) {
          // White-hot core → bright iris → dark sclera gap → luminous
          // limbal ring. Per-band clamps keep the concentric structure
          // legible even when an emotion pushes eyeGlow far above 1 —
          // otherwise anger saturates the whole ellipse into one blob.
          b = er < 0.18 ? Math.min(1.4, 1.6 * p.eyeGlow)
            : er < 0.6 ? Math.min(1.2, 1.05 * p.eyeGlow)
            : er < 0.85 ? Math.min(0.85, 0.55 * p.eyeGlow)
            : Math.min(1.1, 0.9 * p.eyeGlow);
          reg = REGION.EYE;
        } else if (er < 2.8) {
          b -= 0.07; // socket shadow
          if (reg === REGION.FACE || reg === REGION.CHEEK_PLANE) {
            b = Math.max(0.008, b);
            reg = REGION.ORBIT;
          }
        }

        // ---- nose: luminous ridge + nostril wings ---------------------
        if (reg === REGION.FACE) {
          if (au < 0.028 && v1 > -0.32 && v1 < 0.26) {
            b = Math.max(b, 0.55);
            reg = REGION.NOSE_PLANE;
          } else if (v1 > 0.24 && v1 < 0.31 && au > 0.04 && au < 0.11) {
            b = 0.015;
            reg = REGION.NOSTRIL;
          }
        }

        // ---- mouth ---------------------------------------------------
        if (reg === REGION.FACE && au < halfW + 0.05 && v1 > vM - 0.22 && v1 < vM + 0.24) {
          const xn = Math.min(1, au / halfW);
          const borrowedAsym = s * (p.asym * 0.012 + dyn.energy * 0.004 * Math.sin(t * 3.1));
          const mid = vM - p.mouthCurve * 0.12 * (xn * xn - 0.35) + borrowedAsym;
          const yU = mid - open * 0.085;
          const yL = mid + open * 0.115;
          if (au <= halfW) {
            if (open < 0.25 && Math.abs(v1 - mid) < 0.014) {
              // Closed mouth: a dark labial crease between bright lips —
              // the slit is what makes the mouth legible at glyph scale.
              b = 0.06;
              reg = REGION.MOUTH;
            } else if (Math.abs(v1 - yU) < lipT || Math.abs(v1 - yL) < lipT) {
              b = Math.max(b, Math.min(1.15, lipBright));
              reg = REGION.MOUTH;
            } else if (v1 > yU && v1 < yL) {
              // Inner mouth: dark void that boils with speech energy
              b = 0.01 + dyn.energy * 0.06;
              reg = REGION.MOUTH_INNER;
            }
          }
          // Speech turbulence radiates around the mouth region
          if (dyn.energy > 0.02 && reg === REGION.FACE) {
            const mr = (au * au + (v1 - vM) * (v1 - vM)) / (0.3 * 0.3);
            if (mr < 1) b += dyn.energy * 0.25 * (1 - mr) * nz;
          }
        }

        // ---- structural machine landmarks ---------------------------
        const port = u0 > 0.43 && u0 < 0.56 && v1 > 0.02 && v1 < 0.22;
        const hingeWidth = this.geometry === 'smooth'
          ? Math.max(0.32, 0.49 - Math.max(0, v1 - 0.3) * 0.28)
          : headHalfWidth(v1, dyn.mouthOpen, p.jawSharp) - 0.035;
        if (port) {
          reg = REGION.TEMPLE_PORT;
          b = 0.018;
        } else if (v1 > 0.28 && v1 < 0.64 && Math.abs(au - hingeWidth) < 0.05) {
          reg = REGION.JAW_HINGE;
          b = Math.max(b, 0.32 + nz * 0.18);
        } else if (v1 > 0.70 && v1 < 1.01 && au < 0.25 &&
                   (au * au / 0.06 + (v1 - 0.83) * (v1 - 0.83) / 0.055) < 1) {
          reg = REGION.CHIN_PLATE;
          b = Math.max(b, 0.25 + nz * 0.12);
        } else {
          const neckX = 0.16 + Math.max(0, v1 - 0.78) * 0.09;
          if (v1 > 0.68 && Math.abs(au - neckX) < 0.032) {
            reg = REGION.NECK_TENDON;
            b = Math.max(b, 0.28 + nz * 0.15);
          }
        }

        material[i] = classifyFaceMaterial(u0, v1, nz, reg);

        const foreheadLight = Math.max(0, 1 - Math.hypot(u0 / 0.5, (v1 + 0.52) / 0.42));
        const cheekLight = Math.max(0, 1 - Math.hypot((Math.abs(u0) - 0.3) / 0.23, (v1 - 0.08) / 0.3));
        const sideFalloff = 1 - Math.min(0.55, Math.abs(u0) * 0.65);
        if (reg === REGION.FACE) b += foreheadLight * 0.22 + cheekLight * 0.18;
        if (material[i] === MATERIAL.SEAM) b *= 0.38;
        if (material[i] === MATERIAL.APERTURE) b = 0.025;
        if (reg !== REGION.EYE) b *= sideFalloff;

        const planeDepth = Math.max(0, Math.min(1,
          (-d + 0.06) * 1.35 + foreheadLight * 0.2 + cheekLight * 0.16));
        const machineDepth = Math.max(0, Math.min(1,
          0.24 + nz * 0.38 +
          (material[i] === MATERIAL.SEAM ? 0.28 : 0) +
          (material[i] >= MATERIAL.ACTUATOR ? 0.3 : 0)));
        if (depth) depth[i] = planeDepth;
        if (substrate) substrate[i] = machineDepth;
        b *= 0.62 + planeDepth * 0.5;

        bright[i] = b * lum * (reg === REGION.EYE ? 1 : coh * 0.85 + 0.15);
        region[i] = reg;
      }
    }
  }
}
