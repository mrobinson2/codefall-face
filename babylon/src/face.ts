import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { Mood } from './config';
import { createIrisFalloff, createSkin } from './skin';
import { animateMouth } from './speech-mouth';
import { createTiles } from './tiles';

type FacePalette = { primary: Color3; accent: Color3 };
type Expression = {
  smile: number;
  browHeight: number;
  browSlant: number;
  eyeHeight: number;
  eyeSlant: number;
  lidHeight: number;
  mouthHalfSpan: number;
  upperLipRaise: number;
  lowerLipDrop: number;
  jawDrop: number;
  cheekRaise: number;
  lipSpread?: number;
};
type Depth = (x: number, y: number) => number;
type Point = readonly [x: number, y: number];
type Surface = { positions: number[]; indices: number[]; colors?: number[]; uvs?: number[]; normalJoins?: Point[] };

const EXPRESSIONS: Record<Mood, Expression> = {
  happy: {
    smile: 0.059, browHeight: 0.039, browSlant: -0.01, eyeHeight: 0.011, eyeSlant: 0.02, lidHeight: 0.061,
    mouthHalfSpan: 0.45, upperLipRaise: 0.015, lowerLipDrop: 0.035, jawDrop: 0.022, cheekRaise: 0.058,
  },
  content: {
    smile: 0.016, browHeight: 0.004, browSlant: 0.05, eyeHeight: 0, eyeSlant: 0.038, lidHeight: 0.064,
    mouthHalfSpan: 0.425, upperLipRaise: 0.003, lowerLipDrop: 0.007, jawDrop: 0, cheekRaise: 0.012,
  },
  angry: {
    smile: -0.025, browHeight: -0.043, browSlant: 0.272, eyeHeight: -0.013, eyeSlant: 0.148, lidHeight: 0.042,
    mouthHalfSpan: 0.350, upperLipRaise: 0.057, lowerLipDrop: 0.169, jawDrop: 0.111, cheekRaise: 0.034,
  },
};

const MIN_Y = -1.17;
const MAX_Y = 1.29;
const MOUTH_Y = -0.543;
const MOUTH_V = (MOUTH_Y - MIN_Y) / (MAX_Y - MIN_Y);
const EYE_X = 0.339;
const EYE_Y = 0.167;
const NOSTRIL_X = 0.111;
const PROFILE: Point[] = [
  [-0.971, 0.46], [-0.845, 0.57], [-0.69, 0.658], [-0.485, 0.711],
  [-0.236, 0.775], [0.037, 0.851], [0.32, 0.873], [0.60, 0.886], [0.79, 0.85],
];

const gaussian = (value: number, center: number, width: number) =>
  Math.exp(-(((value - center) / width) ** 2));

const ellipse = (t: number) => Math.sqrt(Math.max(0, 1 - t * t));

function halfWidth(y: number): number {
  if (y > 0.79) return Math.max(0.004, 0.85 * ellipse((y - 0.79) / (MAX_Y - 0.79)));
  if (y < -0.971) return Math.max(0.004, 0.46 * ellipse((y + 0.971) / (MIN_Y + 0.971)));
  for (let index = 1; index < PROFILE.length; index += 1) {
    const [endY, endWidth] = PROFILE[index];
    if (y > endY) continue;
    const [startY, startWidth] = PROFILE[index - 1];
    const t = Math.max(0, (y - startY) / (endY - startY));
    return startWidth + (endWidth - startWidth) * t;
  }
  return 0.85;
}

function jawY(y: number, expression: Expression) {
  // Leave the upper face fixed as the mandible extends below the jaw hinge.
  return y + Math.min(0, y + 0.38) * (expression.jawDrop / 0.79);
}

function restY(y: number, expression: Expression) {
  return y < -0.38 ? -0.38 + (y + 0.38) / (1 + expression.jawDrop / 0.79) : y;
}

function lipSpan(expression: Expression) {
  return expression.mouthHalfSpan * halfWidth(MOUTH_Y);
}

function mouth(x: number, expression: Expression) {
  const side = x / lipSpan(expression);
  const u = Math.abs(side);
  const shape = Math.max(0, 1 - side * side);
  const spread = expression.lipSpread ?? 0;
  // Taper both edges to the same corner. A slope of zero at the edge avoids
  // the stretched final triangle that a circular cutout puts in the cheek.
  const upperProfile = shape ** (1.16 - spread * 0.22);
  const lowerProfile = shape ** (1.015 - spread * 0.18);
  const relaxedY = jawY(MOUTH_Y, expression);
  const bow = 0.007 * gaussian(u, 0.23, 0.13) - 0.003 * gaussian(u, 0, 0.17);
  const smile = expression.smile * Math.min(1, u) ** 1.95;
  const skew = 0.008 * Math.max(-1, Math.min(1, side));
  const contour = MOUTH_Y + smile + skew;
  const cornerBlend = gaussian(u, 1, 0.35);
  const center = u <= 1 ? contour : relaxedY + (contour - relaxedY) * cornerBlend;
  return {
    upper: center + upperProfile * (expression.upperLipRaise + bow),
    lower: center - lowerProfile * expression.lowerLipDrop,
    aperture: shape,
    u,
  };
}

// The skin is a continuous surface through the cheeks, with rounded lips and
// orbital forms shaped here. Negative Z points toward the front of the face.
function faceDepth(x: number, y: number, expression: Expression): number {
  const ax = Math.abs(x);
  const anatomicalY = restY(y, expression);
  const radius = Math.min(1, ax / halfWidth(anatomicalY));
  const edge = Math.min(1, (1 - radius) * 6);
  const eyeY = y - expression.eyeSlant * (ax - EYE_X) - expression.eyeHeight;
  const browY = y - expression.browHeight - expression.browSlant * (ax - EYE_X)
    - 0.014 * gaussian(ax, 0.39, 0.16);
  const feature = (cx: number, cy: number, wx: number, wy: number, py = y) =>
    gaussian(ax, cx, wx) * gaussian(py, cy, wy);

  let forward = 0;
  forward += 0.124 * feature(0.27, 0.71, 0.66, 0.40);    // frontal bone
  forward += 0.073 * feature(0, 0.36, 0.167, 0.22);      // between the brows
  forward += 0.114 * feature(0.36, 0.296, 0.273, 0.080, browY);
  forward -= 0.127 * feature(0.34, EYE_Y, 0.224, 0.102, eyeY);
  forward += 0.062 * feature(0.43, -0.015 + expression.cheekRaise, 0.228, 0.119); // lower orbit
  forward += 0.158 * feature(0.55, -0.11 + expression.cheekRaise, 0.226, 0.186);
  forward += 0.077 * feature(0.40, -0.225 + expression.cheekRaise, 0.14, 0.207);
  forward -= 0.058 * feature(0.53, -0.47, 0.18, 0.21, anatomicalY);
  forward -= 0.062 * feature(0.77, 0.29, 0.13, 0.286);
  forward += 0.089 * feature(0.49, -0.755, 0.19, 0.187, anatomicalY);
  forward += 0.128 * feature(0.075, -0.94, 0.32, 0.143, anatomicalY);
  forward -= 0.039 * feature(0, -0.785, 0.252, 0.069, anatomicalY);

  forward += 0.174 * feature(0, 0.025, 0.104, 0.269);    // nasal dorsum
  forward += 0.069 * feature(0, -0.081, 0.187, 0.24);    // rounded sides of nose
  forward += 0.270 * feature(0, -0.211, 0.117, 0.105);   // tip and columella
  forward += 0.158 * feature(0.128, -0.247, 0.074, 0.086); // alae
  forward -= 0.057 * feature(NOSTRIL_X, -0.306, 0.047, 0.04); // nostril depressions
  forward += 0.081 * feature(0, -0.463, 0.315, 0.225);   // muzzle plane
  forward += 0.028 * feature(0.037, -0.374, 0.026, 0.079); // philtrum

  const lip = mouth(x, expression);
  const taper = lip.aperture ** 1.12;
  const upperRoll = 0.6 + 0.4 * gaussian(lip.u, 0.25, 0.23);
  const lowerRoll = 0.39 + 0.61 * gaussian(lip.u, 0.04, 0.67);
  forward += 0.046 * taper * upperRoll * gaussian(y, lip.upper + 0.021, 0.031);
  forward += 0.062 * taper * lowerRoll * gaussian(y, lip.lower - 0.025, 0.040);

  const cap = anatomicalY > 1 ? ellipse((anatomicalY - 1) / (MAX_Y - 1))
    : anatomicalY < -0.90 ? ellipse((anatomicalY + 0.90) / (MIN_Y + 0.90)) : 1;
  return 0.12 - cap * (0.60 * ellipse(radius) ** 1.18 + edge * forward);
}

function sampleFront(u: number, v: number, expression: Expression, lower = v < MOUTH_V) {
  const gridY = MIN_Y + v * (MAX_Y - MIN_Y);
  const x = u * halfWidth(gridY);
  let y = jawY(gridY, expression);
  const orbitWarp = 0.064 * gaussian(Math.abs(x), EYE_X, 0.20) * gaussian(gridY, 0.30, 0.185);
  const noseWarp = -0.085 * gaussian(x, 0, 0.14) * gaussian(gridY, -0.195, 0.25);
  y += (1 - u ** 6) * (orbitWarp + noseWarp);
  const spread = lower ? 0.56 : 0.29;
  const distance = Math.max(0, 1 - Math.abs(gridY - MOUTH_Y) / spread);
  const mouthWeight = distance * distance * (3 - 2 * distance);
  if (mouthWeight > 0) {
    const lip = mouth(x, expression);
    const socketWarp = (1 - u ** 6) * (
      0.064 * gaussian(Math.abs(x), EYE_X, 0.20) * gaussian(MOUTH_Y, 0.30, 0.185)
      - 0.085 * gaussian(x, 0, 0.14) * gaussian(MOUTH_Y, -0.195, 0.25)
    );
    const target = lower ? lip.lower : lip.upper;
    y += mouthWeight * (target - jawY(MOUTH_Y, expression) - socketWarp);
  }
  if (v === 0 || v === 1) y = jawY(gridY, expression);
  return new Vector3(x, y, faceDepth(x, y, expression));
}

function surfaceNormals(surface: Surface) {
  const normals: number[] = [];
  VertexData.ComputeNormals(surface.positions, surface.indices, normals);
  for (const [a, b] of surface.normalJoins ?? []) {
    const x = normals[a * 3] + normals[b * 3];
    const y = normals[a * 3 + 1] + normals[b * 3 + 1];
    const z = normals[a * 3 + 2] + normals[b * 3 + 2];
    const length = Math.hypot(x, y, z) || 1;
    for (const vertex of [a, b]) {
      normals[vertex * 3] = x / length;
      normals[vertex * 3 + 1] = y / length;
      normals[vertex * 3 + 2] = z / length;
    }
  }
  return normals;
}

function surfaceMesh(name: string, surface: Surface, scene: Scene, parent: TransformNode, material: StandardMaterial) {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = surface.positions;
  data.indices = surface.indices;
  if (surface.colors) data.colors = surface.colors;
  if (surface.uvs) data.uvs = surface.uvs;
  data.normals = surfaceNormals(surface);
  data.applyToMesh(mesh);
  mesh.parent = parent;
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

function addQuad(indices: number[], a: number, b: number, c: number, d: number, reverse = false) {
  if (reverse) {
    indices.push(a, c, b, b, c, d);
  } else {
    indices.push(a, b, c, b, d, c);
  }
}

function shellSurface(expression: Expression): Surface {
  const columns = 81;
  const lowerSteps = 27;
  const upperSteps = 77;
  const rows = lowerSteps + upperSteps + 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const normalJoins: Point[] = [];
  const layer = rows * columns;

  // Duplicate the row at the lip line, so the two halves can meet at the
  // corners and part around the aperture without tearing the cheeks.
  for (const rear of [false, true]) {
    const offset = rear ? layer : 0;
    for (let row = 0; row < rows; row += 1) {
      const lower = row <= lowerSteps;
      const height = lower
        ? MOUTH_V * row / lowerSteps
        : MOUTH_V + (1 - MOUTH_V) * (row - lowerSteps - 1) / upperSteps;
      for (let column = 0; column < columns; column += 1) {
        const u = 2 * column / (columns - 1) - 1;
        const nominalY = MIN_Y + height * (MAX_Y - MIN_Y);
        const point = rear
          ? new Vector3(u * halfWidth(nominalY), jawY(nominalY, expression),
            0.12 + 0.66 * ellipse(u) * Math.sin(Math.PI * height) ** 0.48)
          : sampleFront(u, height, expression, lower);
        positions.push(point.x, point.y, point.z);
        uvs.push(column / (columns - 1), height);

        const lip = mouth(point.x, expression);
        const lipColor = lip.aperture * Math.max(
          0.87 * gaussian(point.y, lip.upper + 0.014, 0.023),
          0.66 * gaussian(point.y, lip.lower - 0.021, 0.032),
        );
        const temple = Math.abs(u) ** 5;
        const tone = rear ? 0.49 : (0.91 - 0.20 * temple) * (1 - 0.22 * lipColor);
        colors.push(tone, tone * (1 - 0.035 * lipColor), tone * (1 - 0.048 * lipColor), 1);

        const vertex = offset + row * columns + column;
        if (row === lowerSteps && (rear || Math.abs(u) >= expression.mouthHalfSpan - 0.0001)) {
          normalJoins.push([vertex, vertex + columns]);
        }
        if (row === rows - 1 || column === columns - 1 || row === lowerSteps) continue;
        addQuad(indices, vertex, vertex + 1, vertex + columns, vertex + columns + 1, rear);
      }
    }
  }

  return { positions, indices, colors, uvs, normalJoins };
}

function insideMouth(x: number, expression: Expression) {
  const lip = mouth(x, expression);
  const lowerZ = faceDepth(x, lip.lower, expression);
  const upperZ = faceDepth(x, lip.upper, expression);
  const breadth = lip.aperture;
  return (t: number) => {
    const y = lip.lower * (1 - t) + lip.upper * t;
    const depth = 0.008 + breadth * 0.138 * Math.sin(Math.PI * t);
    return [y, lowerZ * (1 - t) + upperZ * t + depth] as const;
  };
}

function cavitySurface(expression: Expression): Surface {
  const columns = 57;
  const rows = 19;
  const width = lipSpan(expression);
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  for (let column = 0; column < columns; column += 1) {
    const u = 2 * column / (columns - 1) - 1;
    const x = u * width;
    const cavityPoint = insideMouth(x, expression);
    for (let row = 0; row < rows; row += 1) {
      const t = row / (rows - 1);
      const [y, z] = cavityPoint(t);
      const floor = 0.65 * gaussian(t, 0.17, 0.158) * gaussian(u, -0.07, 0.61);
      positions.push(x, y, z);
      colors.push(0.14 + floor, 0.10 + floor * 0.88, 0.11 + floor * 0.85, 1);
      if (column === 0 || row === 0) continue;
      const vertex = column * rows + row;
      addQuad(indices, vertex - rows - 1, vertex - 1, vertex - rows, vertex);
    }
  }
  return { positions, indices, colors };
}

function ridgeSurface(expression: Expression): Surface {
  const columns = 43;
  const rows = 5;
  const span = lipSpan(expression) * 0.72;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const angry = expression.jawDrop > 0.1;
  for (let column = 0; column < columns; column += 1) {
    const u = 2 * column / (columns - 1) - 1;
    const x = u * span;
    const cavityPoint = insideMouth(x, expression);
    const taper = Math.max(0, 1 - u * u) ** 0.84;
    for (let row = 0; row < rows; row += 1) {
      const v = row / (rows - 1);
      const t = 0.90 - taper * (angry ? 0.17 : 0.16) * v;
      const [y, z] = cavityPoint(t);
      // Fit the ridge to the same depth field so it stays just in front of the
      // oral wall and under the lip as the viewer moves.
      positions.push(x, y, z - 0.016 - 0.003 * taper * Math.sin(Math.PI * v));
      const shade = 0.20 + 0.56 * taper * Math.sin(Math.PI * v) ** 0.60;
      colors.push(shade, shade, shade, 1);
      if (column === 0 || row === 0) continue;
      const vertex = column * rows + row;
      addQuad(indices, vertex - rows - 1, vertex - rows, vertex - 1, vertex);
    }
  }
  return { positions, indices, colors };
}

function stabilizeSpeechShell(rest: Surface, pose: Surface) {
  for (let index = 0; index < rest.positions.length; index += 3) {
    const x = rest.positions[index];
    const y = rest.positions[index + 1];
    const inward = Math.max(0, Math.min(1, (0.54 - Math.abs(x)) / 0.21));
    const downward = Math.max(0, Math.min(1, (-0.337 - y) / 0.102));
    // Keep the nostrils, eyes and cheek plates attached to the same sculpt
    // while the lips and center of the mandible deform.
    const weight = inward * inward * (3 - 2 * inward) * downward * downward * (3 - 2 * downward);
    for (let axis = 0; axis < 3; axis += 1) {
      const vertex = index + axis;
      pose.positions[vertex] = rest.positions[vertex] + weight * (pose.positions[vertex] - rest.positions[vertex]);
    }
  }
}

function buildSpeakingSurfaces(scene: Scene, root: TransformNode, shell: StandardMaterial,
  inside: StandardMaterial, ridge: StandardMaterial, mood: Mood, rest: Expression) {
  const angry = mood === 'angry';
  const round = { ...rest, upperLipRaise: 0.032, lowerLipDrop: angry ? 0.207 : 0.144, jawDrop: angry ? 0.17 : 0.111 };
  const spread = { ...rest, smile: rest.smile + 0.023, upperLipRaise: 0.024, lowerLipDrop: 0.069, jawDrop: 0.046, lipSpread: 1 };
  const closed = angry ? { ...rest, upperLipRaise: 0.006, lowerLipDrop: 0.013, jawDrop: 0.023 } : undefined;

  function makeSurface(name: string, material: StandardMaterial, make: (expression: Expression) => Surface) {
    const base = make(rest);
    const mesh = surfaceMesh(name, base, scene, root, material);
    function bake(expression: Expression) {
      const pose = make(expression);
      if (base.uvs) stabilizeSpeechShell(base, pose);
      return { positions: pose.positions, normals: surfaceNormals(pose) };
    }
    const apply = animateMouth(mesh, bake(round), bake(spread), closed ? bake(closed) : undefined);
    return { mesh, apply };
  }

  const skin = makeSurface('Continuous cranium and lip surfaces', shell, shellSurface);
  const mouth = makeSurface('Recessed oral cavity', inside, cavitySurface);
  const jawRidge = makeSurface('Upper interior ridge', ridge, ridgeSurface);
  if (mood === 'content') jawRidge.mesh.setEnabled(false);
  return (rounded: number, widened: number, gap: number) => {
    skin.apply(rounded, widened, gap);
    mouth.apply(rounded, widened, gap);
    if (mood === 'content') jawRidge.mesh.setEnabled(rounded + widened > 0.035);
    jawRidge.apply(rounded, widened, gap);
  };
}

function buildNeck(scene: Scene, parent: TransformNode, material: StandardMaterial) {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const steps = 64;
  const rows = 32;
  for (let row = 0; row <= rows; row += 1) {
    const height = row / rows;
    const edge = Math.min(1, height / 0.33);
    const opacity = edge * edge * (3 - 2 * edge);
    const y = -1.85 + height * 1.03;
    const width = 0.39 + 0.19 * (1 - height) ** 3 + 0.06 * height;
    for (let step = 0; step <= steps; step += 1) {
      const angle = step / steps * Math.PI * 2;
      const x = width * Math.sin(angle);
      const tendon = 0.036 * gaussian(Math.abs(x), 0.22 - (1 - height) * 0.045, 0.077);
      const z = 0.23 - Math.cos(angle) * (0.38 + tendon - 0.11 * (1 - height));
      const shade = 0.24 + 0.4 * height ** 1.4;
      positions.push(x, y, z);
      colors.push(shade * 0.72, shade * 0.77, shade * 0.88, opacity);
      uvs.push(step / steps * 1.6, height * 0.65);
      const index = positions.length / 3 - 1;
      if (row && step) addQuad(indices, index - steps - 2, index - steps - 1, index - 1, index);
    }
  }
  const bust = surfaceMesh('Neck and lower bust', { positions, indices, colors, uvs }, scene, parent, material);
  bust.hasVertexAlpha = true;
}

function eyeShape(
  depth: Depth,
  scene: Scene,
  parent: TransformNode,
  material: StandardMaterial,
  name: string,
  side: number,
  width: number,
  height: number,
  lift: number,
  centerX: number,
  centerY: number,
  eyeOrigin: number,
  tilt: number,
  radial = false,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const count = 45;
  const crossSections = 9;
  for (let index = 0; index < count; index += 1) {
    const t = 2 * index / (count - 1) - 1;
    const x = side * (centerX + width * t);
    const slant = tilt * width * t;
    const arc = Math.max(0, 1 - t * t) ** (radial ? 0.5 : 0.68);
    const upper = height * arc * (radial ? 1 : 1 - t * 0.20);
    const lower = height * arc * (radial ? 1 : 0.64 + t * 0.12);
    // Subdivide vertically as well as horizontally. Otherwise the edges of a
    // recessed socket would bridge its concave center and cover the emissive eye.
    for (let row = 0; row < crossSections; row += 1) {
      const edge = -lower + (upper + lower) * row / (crossSections - 1);
      const y = centerY + slant + edge;
      positions.push(x, y - eyeOrigin, depth(x, y) - lift);
      if (radial) uvs.push((t + 1) * 0.5, 0.5 + edge / (2 * height));
      if (index === 0 || row === 0) continue;
      const vertex = index * crossSections + row;
      addQuad(indices, vertex - crossSections - 1, vertex - 1, vertex - crossSections, vertex, side < 0);
    }
  }
  return surfaceMesh(name, { positions, indices, uvs: radial ? uvs : undefined }, scene, parent, material);
}

function buildLids(
  scene: Scene,
  parent: TransformNode,
  material: StandardMaterial,
  expression: Expression,
  depth: Depth,
  side: number,
  centerY: number,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const sections = 61;
  const rows = 7;
  const width = 0.191;
  for (const edge of [-1, 1]) {
    const offset = positions.length / 3;
    for (let section = 0; section < sections; section += 1) {
      const t = 2 * section / (sections - 1) - 1;
      const x = side * (EYE_X + width * t);
      const arc = ellipse(t) ** 1.36;
      const bulge = edge === 1 ? 1 - t * 0.20 : 0.64 + t * 0.12;
      const lid = expression.lidHeight * arc * bulge;
      const center = centerY + expression.eyeSlant * width * t;
      for (let row = 0; row < rows; row += 1) {
        const v = row / (rows - 1);
        const y = center + edge * (lid + (v * 0.037 - 0.009) * arc);
        const margin = 0.027 * arc * ellipse(v) + 0.005 * arc;
        positions.push(x, y, depth(x, y) - margin);
        uvs.push((0.5 + x / (2 * halfWidth(y))), (y - MIN_Y) / (MAX_Y - MIN_Y));
        if (!section || !row) continue;
        const vertex = offset + section * rows + row;
        addQuad(indices, vertex - rows - 1, vertex - 1, vertex - rows, vertex, side * edge < 0);
      }
    }
  }
  surfaceMesh('Upper and lower palpebral rims', { positions, indices, uvs }, scene, parent, material);
}

function unlit(name: string, scene: Scene, emissive: Color3) {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.diffuseColor.set(0, 0, 0);
  material.specularColor.set(0, 0, 0);
  material.emissiveColor.copyFrom(emissive);
  material.backFaceCulling = false;
  return material;
}

export function createFace(scene: Scene, parent: TransformNode, theme: FacePalette) {
  const shell = new StandardMaterial('Etched mask', scene);
  shell.diffuseTexture = createSkin(scene);
  shell.specularPower = 43;
  shell.backFaceCulling = false;

  const neck = new StandardMaterial('Dark lattice of the neck', scene);
  neck.diffuseTexture = shell.diffuseTexture;
  neck.specularColor.set(0.012, 0.015, 0.017);
  neck.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  buildNeck(scene, parent, neck);

  const cavity = new StandardMaterial('Recesses', scene);
  cavity.emissiveColor.set(0.0003, 0.0003, 0.00045);
  cavity.diffuseColor.set(0.016, 0.010, 0.013);
  cavity.specularColor.set(0.024, 0.011, 0.015);
  cavity.specularPower = 16;
  cavity.backFaceCulling = false;

  const inside = new StandardMaterial('Shadowed oral interior', scene);
  inside.emissiveColor.set(0.0021, 0.00125, 0.0009);
  inside.diffuseColor.set(0.048, 0.037, 0.032);
  inside.specularColor.set(0.018, 0.013, 0.013);
  inside.backFaceCulling = false;

  const ridge = new StandardMaterial('Dark ceramic ridge', scene);
  ridge.diffuseColor.set(0.126, 0.115, 0.102);
  ridge.specularColor.set(0.038, 0.037, 0.036);
  ridge.emissiveColor.set(0.018, 0.015, 0.012);
  ridge.backFaceCulling = false;

  const eyeWhite = new StandardMaterial('Graphite sclera', scene);
  eyeWhite.diffuseColor.set(0.043, 0.051, 0.056);
  eyeWhite.specularColor.set(0.11, 0.14, 0.16);
  eyeWhite.specularPower = 46;
  eyeWhite.backFaceCulling = false;
  const darkIris = new StandardMaterial('Dark iridal membrane', scene);
  darkIris.diffuseColor.set(0.013, 0.017, 0.019);
  darkIris.specularColor.set(0.038, 0.041, 0.044);
  darkIris.backFaceCulling = false;
  const iris = unlit('Iris halo', scene, Color3.Black());
  iris.opacityTexture = createIrisFalloff(scene);
  iris.disableDepthWrite = true;
  const pupils = unlit('Eye points', scene, Color3.Black());
  type Fixture = {
    root: TransformNode;
    shutters: TransformNode[];
    tiles: ReturnType<typeof createTiles>;
    speak: ReturnType<typeof buildSpeakingSurfaces>;
  };
  const fixtures = new Map<Mood, Fixture>();
  let active: Fixture | undefined;
  let palette = theme;
  let speechActivity = 0;
  let speechRound = 0;
  let speechWide = 0;
  let speechGap = 0;

  function getFixture(mood: Mood) {
    const cached = fixtures.get(mood);
    if (cached) return cached;

    const expression = EXPRESSIONS[mood];
    const depth: Depth = (x, y) => faceDepth(x, y, expression);
    const root = new TransformNode(`Face expression: ${mood}`, scene);
    root.parent = parent;
    const shutters: TransformNode[] = [];
    const speak = buildSpeakingSurfaces(scene, root, shell, inside, ridge, mood, expression);

    for (const side of [-1, 1]) {
      const nostrilDepth: Depth = (x, y) => depth(x, y) + 0.008 * gaussian(x, side * NOSTRIL_X, 0.037);
      eyeShape(nostrilDepth, scene, root, cavity, 'Nostril', side, 0.052, 0.019, 0.017,
        NOSTRIL_X, -0.299, 0, 0.30);
      const centerY = EYE_Y + expression.eyeHeight;
      const slant = expression.eyeSlant;
      const eyeballDepth: Depth = (x, y) => depth(x, y)
        - 0.046 * gaussian(Math.abs(x), EYE_X, 0.143) * gaussian(y, centerY, 0.061);
      eyeShape(depth, scene, root, cavity, 'Orbital recess', side, 0.195, expression.lidHeight + 0.010,
        0.013, EYE_X, centerY, 0, slant);
      eyeShape(eyeballDepth, scene, root, eyeWhite, 'Recessed sclera', side, 0.184, expression.lidHeight - 0.009,
        0.018, EYE_X, centerY, 0, slant);
      eyeShape(eyeballDepth, scene, root, darkIris, 'Iris', side, 0.067, expression.lidHeight * 0.68,
        0.021, EYE_X, centerY, 0, 0, true);
      buildLids(scene, root, shell, expression, depth, side, centerY);

      const shutter = new TransformNode('Eye signal column', scene);
      shutter.parent = root;
      shutter.position.y = centerY;
      shutters.push(shutter);
      eyeShape(eyeballDepth, scene, shutter, iris, 'Eye halo', side, 0.092, 0.087, 0.030,
        EYE_X, centerY, centerY, 0, true);
      eyeShape(eyeballDepth, scene, shutter, pupils, 'Pupil discharge', side, 0.018, 0.019, 0.039,
        EYE_X, centerY, centerY, 0, true);
    }

    const tiles = createTiles(scene, root, (u, v) => sampleFront(u, v, expression), mood);
    tiles.setColors(palette);
    const fixture = { root, shutters, tiles, speak };
    fixtures.set(mood, fixture);
    return fixture;
  }

  function setMood(mood: Mood) {
    const next = getFixture(mood);
    if (active === next) return;
    active?.root.setEnabled(false);
    active = next;
    active.root.setEnabled(true);
    active.speak(speechRound, speechWide, speechGap);
  }

  function setSpeech(open: number, wide: number, speaking = open > 0.002) {
    const aperture = Number.isFinite(open) ? Math.max(0, Math.min(1, open)) : 0;
    const spread = Number.isFinite(wide) ? Math.max(0, Math.min(1, wide)) * 0.86 : 0;
    const dt = Math.min(0.05, (scene.getEngine().getDeltaTime() || 1000 / 60) / 1000);
    speechActivity += (Number(speaking) - speechActivity) * (1 - Math.exp(-17 * dt));
    if (!speaking && speechActivity < 0.002) speechActivity = 0;
    const openAmount = Math.pow(aperture, 0.78) * speechActivity;
    speechRound = openAmount * (1 - spread);
    speechWide = openAmount * spread;
    speechGap = speechActivity - openAmount;
    active?.speak(speechRound, speechWide, speechGap);
  }

  let signal = Color3.Black();
  let eyeIntensity = 1;
  let irisPulse = 0.57;

  function applyEyeEmission() {
    signal.scaleToRef(irisPulse * eyeIntensity, iris.emissiveColor);
    pupils.emissiveColor.set(
      (0.82 + signal.r * 0.49) * eyeIntensity,
      (0.82 + signal.g * 0.49) * eyeIntensity,
      (0.85 + signal.b * 0.49) * eyeIntensity,
    );
  }

  function setEyeIntensity(value: number) {
    const intensity = Math.max(0, Math.min(1, value));
    if (eyeIntensity === intensity) return;
    eyeIntensity = intensity;
    applyEyeEmission();
  }

  function setColors(next: FacePalette) {
    palette = next;
    signal = palette.primary.toLinearSpace();
    const materialColor = Color3.Lerp(signal, palette.accent.toLinearSpace(), 0.27);
    materialColor.scaleToRef(0.89, shell.diffuseColor);
    shell.specularColor.set(
      0.071 + materialColor.r * 0.049,
      0.075 + materialColor.g * 0.046,
      0.078 + materialColor.b * 0.045,
    );
    materialColor.scaleToRef(0.34, neck.diffuseColor);
    neck.emissiveColor.set(0.001, 0.001, 0.0012);
    shell.emissiveColor.set(0.0008 + materialColor.r * 0.004, 0.0008 + materialColor.g * 0.004, 0.001 + materialColor.b * 0.004);
    applyEyeEmission();
    for (const fixture of fixtures.values()) fixture.tiles.setColors(palette);
  }
  setColors(theme);
  setMood('content');

  return {
    setColors,
    setMood,
    setSpeech,
    setEyeIntensity,
    update(time: number, motion: number) {
      irisPulse = 0.57 + 0.08 * motion * Math.sin(time * 2.2);
      signal.scaleToRef(irisPulse * eyeIntensity, iris.emissiveColor);
      const blinkPhase = (time + 3.8) % 7.7;
      const blink = Math.max(0, 1 - Math.abs(blinkPhase - 0.16) / 0.16);
      for (const shutter of active?.shutters ?? []) shutter.scaling.y = 1 - 0.88 * blink ** 2 * motion;
      active?.tiles.update(time, motion);
    },
  };
}
