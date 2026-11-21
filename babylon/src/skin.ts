import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

const COLUMNS = 57;
const ROWS = 75;
const CELL = 16;

function variation(column: number, row: number, salt = 0) {
  let mixed = Math.imul(column + 1, 73517) ^ Math.imul(row + 1, 2246822519) ^ salt;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 3266489917);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

export function createSkin(scene: Scene) {
  const texture = new DynamicTexture('Etched semiconductor skin', { width: COLUMNS * CELL, height: ROWS * CELL }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const context = texture.getContext();
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  context.fillStyle = '#282828';
  context.fillRect(0, 0, COLUMNS * CELL, ROWS * CELL);

  // The UVs bend with the landmarks, so the cell seams follow cheek and brow contours.
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const x = column * CELL;
      const y = row * CELL;
      const field = variation(Math.floor(column / 5), Math.floor(row / 5), 420);
      const detail = variation(column, row);
      const tone = Math.round(202 + 22 * field + 23 * detail - (detail < 0.08 ? 54 : 0));
      context.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
      context.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      context.fillStyle = 'rgba(255, 255, 255, 0.22)';
      context.fillRect(x + 1, y + 1, CELL - 2, 1);
      context.fillStyle = 'rgba(0, 0, 0, 0.21)';
      context.fillRect(x + 1, y + CELL - 2, CELL - 2, 1);

      if (detail > 0.84) {
        // Sparse pixel etchings register as small code fragments at portrait scale.
        context.fillStyle = 'rgba(18, 18, 18, 0.22)';
        const offset = 3 + Math.floor(variation(column, row, 749) * 4);
        context.fillRect(x + offset, y + 4, 6, 2);
        context.fillRect(x + offset, y + 6, 2, 5);
        if (detail > 0.94) context.fillRect(x + offset + 2, y + 9, 4, 2);
      }
    }
  }

  texture.update();
  return texture;
}

export function createIrisFalloff(scene: Scene) {
  const size = 64;
  const texture = new DynamicTexture('Iris glow falloff', size, scene, false);
  const context = texture.getContext();
  const center = size / 2;
  const falloff = context.createRadialGradient(center, center, 0, center, center, center);
  falloff.addColorStop(0, 'rgba(255, 255, 255, 0.90)');
  falloff.addColorStop(0.28, 'rgba(255, 255, 255, 0.52)');
  falloff.addColorStop(0.66, 'rgba(255, 255, 255, 0.11)');
  falloff.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = falloff;
  context.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}
