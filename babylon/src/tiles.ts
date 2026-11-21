import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Mood } from './config';

type Sampler = (u: number, v: number) => Vector3;
type Palette = { primary: Color3; accent: Color3 };
type Surface = { positions: number[]; indices: number[]; colors: number[]; finishes: number[] };
type Frame = { center: Vector3; across: Vector3; up: Vector3; normal: Vector3 };

const columns = 22;
const rows = 34;
const rowStep = 1 / rows;
const columnStep = 2 / columns;
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const finishGrades = 8;
const finishBands = [
  { low: 0.035, high: 0.075, minGloss: 0.28, maxGloss: 0.53 }, // sides
  { low: 0.18, high: 0.31, minGloss: 0.48, maxGloss: 0.84 },   // bevels
  { low: 0.10, high: 0.21, minGloss: 0.39, maxGloss: 0.72 },   // top faces
] as const;

function createFinishSwatches(scene: Scene) {
  // A small linear specular map keeps roughness and reflection strength
  // separate from tint without splitting the plates into material groups.
  const rgba = new Uint8Array(finishGrades * finishBands.length * 4);
  finishBands.forEach(({ low, high, minGloss, maxGloss }, row) => {
    for (let grade = 0; grade < finishGrades; grade++) {
      const t = grade / (finishGrades - 1);
      const intensity = Math.round(255 * (low + t * (high - low)));
      const gloss = Math.round(255 * (minGloss + t * (maxGloss - minGloss)));
      rgba.set([intensity, intensity, intensity, gloss], (row * finishGrades + grade) * 4);
    }
  });
  const texture = RawTexture.CreateRGBATexture(
    rgba, finishGrades, finishBands.length, scene, false, false, Texture.NEAREST_SAMPLINGMODE,
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.gammaSpace = false;
  return texture;
}

function noise(column: number, row: number, salt = 0) {
  let word = Math.imul(column + 31, 0x9e3779b1) ^ Math.imul(row + 41, 0x85ebca77) ^ salt;
  word = Math.imul(word ^ (word >>> 16), 0x7feb352d);
  return ((word ^ (word >>> 15)) >>> 0) / 4294967296;
}

function patch(u: number, v: number, x: number, y: number, width: number, height: number) {
  return Math.max(0, 1 - ((u - x) / width) ** 2 - ((v - y) / height) ** 2);
}

function reliefCoverage(u: number, v: number) {
  const forehead = patch(u, v, -0.19, 0.82, 0.79, 0.20);
  const crown = patch(u, v, 0.37, 0.91, 0.56, 0.105);
  const temples = Math.max(
    patch(u, v, -0.84, 0.71, 0.23, 0.24),
    patch(u, v, 0.83, 0.721, 0.29, 0.24),
  );
  const cheeks = Math.max(
    patch(u, v, -0.73, 0.414, 0.27, 0.103),
    0.77 * patch(u, v, 0.65, 0.442, 0.30, 0.087),
  );
  const jaw = 0.55 * patch(u, v, 0.84, 0.25, 0.24, 0.12);
  return Math.max(forehead, crown, temples, cheeks, jaw);
}

function frameAt(sample: Sampler, u: number, v: number): Frame {
  const step = 0.007;
  const across = sample(u + step, v).subtract(sample(u - step, v)).normalize();
  const vertical = sample(u, v + step).subtract(sample(u, v - step)).normalize();
  // The front of the sculpt faces negative Z.
  const normal = Vector3.Cross(vertical, across).normalize();
  return { center: sample(u, v), across, up: Vector3.Cross(across, normal).normalize(), normal };
}

function appendQuad(
  surface: Surface, points: readonly Vector3[], color: Color3, grade: number, band: number,
) {
  const index = surface.positions.length / 3;
  for (const point of points) {
    surface.positions.push(point.x, point.y, point.z);
    surface.colors.push(color.r, color.g, color.b, 1);
    surface.finishes.push((grade + 0.5) / finishGrades, (band + 0.5) / finishBands.length);
  }
  surface.indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
}

function appendPlate(
  surface: Surface,
  frame: Frame,
  width: number,
  height: number,
  rise: number,
  embed: number,
  tint: Color3,
  grade: number,
) {
  const { center, across, up, normal } = frame;
  const bevel = Math.min(width, height, rise) * 0.20;
  const ring = (inset: number, depth: number) => corners.map(([x, y]) =>
    center.add(across.scale(x * (width / 2 - inset)))
      .addInPlace(up.scale(y * (height / 2 - inset)))
      .addInPlace(normal.scale(depth)));
  const bottom = ring(0, -embed);
  const shoulder = ring(0, rise - bevel);
  const top = ring(bevel, rise);
  for (let side = 0; side < corners.length; side++) {
    const next = (side + 1) % corners.length;
    appendQuad(surface, [bottom[side], bottom[next], shoulder[next], shoulder[side]], tint.scale(0.45), grade, 0);
    appendQuad(surface, [shoulder[side], shoulder[next], top[next], top[side]], tint.scale(1.04), grade, 1);
  }
  appendQuad(surface, top, tint, grade, 2);
  if (embed === 0) appendQuad(surface, bottom.reverse(), tint.scale(0.40), grade, 0);
}

function makeMesh(name: string, scene: Scene, parent: TransformNode, surface: Surface, material: StandardMaterial) {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  const normals: number[] = [];
  VertexData.ComputeNormals(surface.positions, surface.indices, normals);
  data.positions = surface.positions;
  data.indices = surface.indices;
  data.normals = normals;
  data.colors = surface.colors;
  data.uvs = surface.finishes;
  data.applyToMesh(mesh);
  mesh.parent = parent;
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

function buildRelief(sample: Sampler): Surface {
  const surface: Surface = { positions: [], indices: [], colors: [], finishes: [] };
  for (let row = 6; row < rows - 1; row++) {
    const v = (row + 0.5) * rowStep;
    for (let column = 0; column < columns; column++) {
      const u = (column + 0.5) * columnStep - 1;
      const coverage = reliefCoverage(u, v);
      const inclusion = noise(column, row, 8055);
      if (inclusion > coverage * 1.08 || (v > 0.50 && v < 0.60 && Math.abs(u) < 0.75)) continue;

      const spacing = sample(u + columnStep * 0.5, v).subtract(sample(u - columnStep * 0.5, v)).length();
      const width = Math.min(spacing * (0.70 + noise(column, row, 3654) * 0.22), 0.099);
      const height = 0.049 + noise(column, row, 9283) * 0.016;
      const chatter = noise(column, row, 5977);
      const faceHeight = 0.007 + 0.038 * chatter ** 2 + 0.020 * Math.abs(u) ** 2;
      const value = 0.59 + 0.39 * noise(column, row, 1683) - (chatter > 0.94 ? 0.17 : 0);
      const patina = 0.046 * (noise(column, row, 8217) - 0.5);
      const tint = new Color3(value * (1 + patina), value, value * (1 - patina));
      const grade = Math.floor(finishGrades * noise(column, row, 5672));
      appendPlate(surface, frameAt(sample, u, v), width, height, faceHeight, 0.024, tint, grade);
    }
  }
  return surface;
}

function buildFragments(sample: Sampler): Surface {
  const surface: Surface = { positions: [], indices: [], colors: [], finishes: [] };
  for (let i = 0; i < 36; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const v = 0.42 + 0.552 * noise(i, 77, 129);
    const jitter = noise(i, 81, 376);
    const frame = frameAt(sample, side * (0.895 + 0.058 * jitter), v);
    const gap = 0.034 + 0.23 * noise(i, 73, 554) ** 2;
    frame.center.x += side * gap;
    frame.center.y += Math.max(0, v - 0.66) * gap;
    frame.center.z += (jitter - 0.32) * 0.23;
    const angle = (noise(i, 68, 556) - 0.5) * 0.7;
    const across = frame.across.scale(Math.cos(angle)).addInPlace(frame.up.scale(Math.sin(angle)));
    frame.across = across;
    frame.up = Vector3.Cross(across, frame.normal).normalize();
    const size = 0.013 + 0.043 * noise(i, 75, 942) ** 2;
    const value = (0.56 - gap) * (0.74 + jitter * 0.48);
    appendPlate(surface, frame, size, size * (0.83 + jitter * 0.31), size * 0.72, 0,
      new Color3(value * 0.98, value, value * 1.02), Math.floor(finishGrades * jitter));
  }
  return surface;
}

// Bake each expression onto its own surface sample. Face relief and drifting
// fragments are each merged into a single mesh, regardless of block count.
export function createTiles(scene: Scene, parent: TransformNode, sample: Sampler, mood: Mood) {
  const material = new StandardMaterial(`${mood} voxel alloy`, scene);
  material.specularTexture = createFinishSwatches(scene);
  material.useGlossinessFromSpecularMapAlpha = true;
  material.specularPower = 45;
  makeMesh(`${mood} raised face tiles`, scene, parent, buildRelief(sample), material);
  const fragments = makeMesh(`${mood} detached face tiles`, scene, parent, buildFragments(sample), material);

  return {
    setColors(palette: Palette) {
      const alloy = Color3.Lerp(palette.primary.toLinearSpace(), palette.accent.toLinearSpace(), 0.28);
      alloy.scaleToRef(0.77, material.diffuseColor);
      material.emissiveColor.set(0.0003 + alloy.r * 0.001, 0.0003 + alloy.g * 0.001, 0.00035 + alloy.b * 0.001);
    },
    update(time: number, motion: number) {
      fragments.position.y = motion * 0.013 * Math.sin(time * 0.91);
      fragments.position.z = motion * 0.009 * Math.sin(time * 1.13 + 1);
    },
  };
}
