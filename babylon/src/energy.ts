import { Constants } from '@babylonjs/core/Engines/constants.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import type { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';

type Palette = { primary: Color3; accent: Color3 };
type EnergyOptions = {
  tendrilCount: number;
  particlesPerTendril: number;
  streamSpeed: number;
};

type Strand = {
  root: [number, number, number];
  flow: [number, number, number, number];
  style: [number, number, number, number];
};

// The same centerline runs on the GPU for ribbons and particles. All of the
// geometry buffers stay static. Each frame only changes the clock uniforms.
const curve = `
  attribute vec3 position;
  attribute vec4 flow;
  attribute vec4 style;
  uniform mat4 worldViewProjection;
  uniform float time;
  uniform float motion;
  uniform float streamSpeed;

  vec3 strand(float u) {
    float phase = style.x;
    vec2 axis = vec2(cos(flow.x), sin(flow.x));
    vec2 across = vec2(-axis.y, axis.x);
    float growth = pow(max(u, 0.0), 0.91);
    float curl = flow.z * sin(u * 2.78) + (0.31 * sin(phase * 0.79)) * u * u;
    float wave = u * (
      0.34 * sin(u * (5.9 + 1.9 * sin(phase)) + phase - time * motion * 0.66) +
      0.13 * sin(u * 14.2 - phase * 1.79 - time * motion * 1.03)
    );
    float ridge = 0.074 * sin(u * 24.0 + phase * 2.41 - time * motion * 1.3);
    vec2 center = position.xy + axis * (growth * flow.y) +
      across * (curl * growth + wave + ridge * u * u);
    float depth = position.z + flow.w * u +
      0.21 * u * sin(u * 7.2 - phase - time * motion * 0.8);
    return vec3(center, depth);
  }
`;

const ribbonVertex = `
  precision highp float;
  ${curve}
  attribute vec2 uv;
  varying vec2 strandUV;
  varying vec3 strandStyle;

  void main() {
    float u = uv.x;
    vec3 center = strand(u);
    vec3 ahead = strand(min(u + 0.007, 1.0));
    vec3 behind = strand(max(u - 0.007, 0.0));
    vec2 direction = normalize(ahead.xy - behind.xy);
    vec2 normal = vec2(-direction.y, direction.x);
    float taper = mix(1.0, 0.15, pow(u, 1.35));
    float breath = 0.85 + 0.15 * sin(u * 17.0 + style.x - time * motion * 1.2);
    center.xy += normal * uv.y * style.y * taper * breath;
    gl_Position = worldViewProjection * vec4(center, 1.0);
    strandUV = uv;
    strandStyle = vec3(style.x, style.z, style.w);
  }
`;

const ribbonFragment = `
  precision highp float;
  varying vec2 strandUV;
  varying vec3 strandStyle;
  uniform vec3 primary;
  uniform vec3 accent;
  uniform float time;
  uniform float streamSpeed;
  uniform float emissionLevel;

  void main() {
    float u = strandUV.x;
    float crossSection = abs(strandUV.y);
    float phase = strandStyle.x;
    // Two traveling waves of different lengths break up the glow into pulses.
    float t = time * streamSpeed;
    float pulse = pow(0.5 + 0.5 * cos(29.0 * u - t * 4.1 + phase), 10.0);
    float shimmer = pow(0.5 + 0.5 * sin(63.0 * u - t * 5.2 - phase * 1.4), 5.0);
    float core = exp(-7.8 * crossSection * crossSection);
    float halo = (1.0 - smoothstep(0.28, 1.0, crossSection)) * 0.13;
    float edge = smoothstep(0.0, 0.075, u) * (1.0 - smoothstep(0.67, 1.0, u));
    float intensity = (0.62 + 1.40 * pulse + 0.29 * shimmer) * strandStyle.y;
    vec3 color = mix(primary, accent, strandStyle.z);
    color = mix(color, vec3(0.72, 0.94, 1.0), pulse * 0.23);
    gl_FragColor = vec4(color * intensity * edge * (core + halo) * emissionLevel, 1.0);
  }
`;

const particleVertex = `
  precision highp float;
  ${curve}
  attribute vec2 uv;
  attribute vec4 mote;
  varying vec2 moteUV;
  varying vec3 moteStyle;

  void main() {
    float u = fract(mote.x + time * streamSpeed * mote.y);
    vec3 center = strand(u);
    vec3 next = strand(min(u + 0.007, 1.0));
    vec3 prev = strand(max(u - 0.007, 0.0));
    vec2 direction = normalize(next.xy - prev.xy);
    vec2 normal = vec2(-direction.y, direction.x);
    float drift = sin(style.x * 3.91 + mote.x * 125.0 + u * 4.0);
    center.xy += normal * drift * mote.w * u * u;
    center.xy += direction * uv.x * mote.z;
    center.xy += normal * uv.y * (0.004 + 0.25 * mote.z);
    gl_Position = worldViewProjection * vec4(center, 1.0);
    moteUV = uv;
    moteStyle = vec3(
      smoothstep(0.02, 0.15, u) * (1.0 - smoothstep(0.76, 1.0, u)),
      style.w,
      0.52 + 0.48 * sin(style.x * 6.0 + mote.x * 190.0)
    );
  }
`;

const particleFragment = `
  precision highp float;
  varying vec2 moteUV;
  varying vec3 moteStyle;
  uniform vec3 primary;
  uniform vec3 accent;
  uniform float emissionLevel;

  void main() {
    float along = moteUV.x - 0.44;
    float distanceToHead = 2.6 * along * along + 4.6 * moteUV.y * moteUV.y;
    float falloff = smoothstep(-1.0, -0.45, moteUV.x) *
      (1.0 - smoothstep(0.65, 1.0, moteUV.x)) *
      (1.0 - smoothstep(0.64, 1.0, abs(moteUV.y)));
    float energy = (0.43 + 1.7 * moteStyle.z) * exp(-distanceToHead) * falloff;
    vec3 color = mix(primary, accent, moteStyle.y);
    color = mix(color, vec3(0.83, 0.99, 1.0), 0.14 + 0.19 * moteStyle.z);
    gl_FragColor = vec4(color * energy * moteStyle.x * emissionLevel, 1.0);
  }
`;

// Related strands grow in bundles. Adjacent bundles curve in different
// directions so there are crossings and quieter gaps instead of uniform spokes.
const bundles = [
  { angle: -1.23, bend: 0.58, length: 1.47 },
  { angle: -0.83, bend: -0.53, length: 2.33 },
  { angle: -0.49, bend: -0.66, length: 2.60 },
  { angle: -0.18, bend: 0.81, length: 2.88 },
  { angle: 0.12, bend: -0.88, length: 2.90 },
  { angle: 0.37, bend: 0.51, length: 2.80 },
  { angle: 0.67, bend: 0.64, length: 2.43 },
  { angle: 0.97, bend: -0.92, length: 2.16 },
  { angle: 1.29, bend: -0.79, length: 1.68 },
] as const;

function seededUnit(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeStrands(count: number, unit: () => number): Strand[] {
  return Array.from({ length: count }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const bundleIndex = Math.floor(index / 2) % bundles.length;
    const bundle = bundles[bundleIndex]!;
    const layer = Math.floor(index / (2 * bundles.length));
    const rootAngle = bundle.angle + (unit() - 0.5) * (layer ? 0.38 : 0.15);
    const angle = bundle.angle + (unit() - 0.5) * 0.30 + 0.09 * side;
    const length = bundle.length * (0.82 + unit() * 0.29) * (side === -1 ? 1.04 : 0.97);
    const foreground = layer > 0 && unit() < 0.12;
    const tint = unit();
    const accentBundle = bundleIndex === (side === -1 ? 1 : 7) || bundleIndex === (side === -1 ? 6 : 2);
    const accent = accentBundle || tint < 0.28 ? 0.78 + unit() * 0.22 : unit() * 0.11;
    const thickness = layer === 0 ? 0.017 + unit() * 0.012 : 0.0057 + unit() * 0.009;
    return {
      root: [
        side * (0.15 + 0.64 * Math.cos(rootAngle)),
        0.28 + 0.81 * Math.sin(rootAngle) + (unit() - 0.5) * 0.15,
        foreground ? -0.43 : 0.15 + unit() * 0.50,
      ],
      flow: [
        side === 1 ? angle : Math.PI - angle,
        length,
        side * (bundle.bend + (unit() - 0.5) * (layer ? 1.46 : 0.81)),
        foreground ? -0.35 : (unit() - 0.38) * 1.75,
      ],
      style: [
        unit() * Math.PI * 2,
        thickness,
        layer === 0 ? 0.50 + unit() * 0.54 : 0.18 + unit() * 0.60,
        accent,
      ],
    };
  });
}

type Buffers = {
  positions: Float32Array;
  uv: Float32Array;
  flow: Float32Array;
  style: Float32Array;
  indices: Uint16Array;
};

function allocateBuffers(vertices: number, indexCount: number): Buffers {
  return {
    positions: new Float32Array(vertices * 3),
    uv: new Float32Array(vertices * 2),
    flow: new Float32Array(vertices * 4),
    style: new Float32Array(vertices * 4),
    indices: new Uint16Array(indexCount),
  };
}

function writeVertex(buffers: Buffers, index: number, strand: Strand, u: number, v: number) {
  buffers.positions.set(strand.root, index * 3);
  buffers.uv[index * 2] = u;
  buffers.uv[index * 2 + 1] = v;
  buffers.flow.set(strand.flow, index * 4);
  buffers.style.set(strand.style, index * 4);
}

function createMesh(
  name: string,
  scene: Scene,
  parent: TransformNode,
  buffers: Buffers,
  source: { vertexSource: string; fragmentSource: string },
  motes?: Float32Array,
) {
  const mesh = new Mesh(name, scene);
  mesh.parent = parent;
  mesh.isPickable = false;
  // The positions contain roots. The shader places the actual geometry.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setVerticesData('position', buffers.positions);
  mesh.setVerticesData('uv', buffers.uv);
  mesh.setVerticesData('flow', buffers.flow, false, 4);
  mesh.setVerticesData('style', buffers.style, false, 4);
  mesh.setIndices(buffers.indices);
  if (motes) mesh.setVerticesData('mote', motes, false, 4);

  const material = new ShaderMaterial(name, scene, source, {
    attributes: ['position', 'uv', 'flow', 'style', ...(motes ? ['mote'] : [])],
    uniforms: ['worldViewProjection', 'time', 'motion', 'streamSpeed', 'primary', 'accent', 'emissionLevel'],
    needAlphaBlending: true,
  });
  material.backFaceCulling = false;
  material.alphaMode = Constants.ALPHA_ADD;
  mesh.material = material;
  return material;
}

function createRibbons(scene: Scene, parent: TransformNode, strands: Strand[]) {
  const segments = 54;
  const stride = (segments + 1) * 2;
  const buffers = allocateBuffers(strands.length * stride, strands.length * segments * 6);
  strands.forEach((strand, index) => {
    for (let step = 0; step <= segments; step++) {
      const vertex = index * stride + step * 2;
      writeVertex(buffers, vertex, strand, step / segments, -1);
      writeVertex(buffers, vertex + 1, strand, step / segments, 1);
      if (step < segments) {
        const offset = (index * segments + step) * 6;
        buffers.indices.set([vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3], offset);
      }
    }
  });
  return createMesh('energy filaments', scene, parent, buffers, {
    vertexSource: ribbonVertex, fragmentSource: ribbonFragment,
  });
}

function createMotes(
  scene: Scene,
  parent: TransformNode,
  strands: Strand[],
  perStrand: number,
  unit: () => number,
) {
  const count = strands.length * perStrand;
  const buffers = allocateBuffers(count * 4, count * 6);
  const motes = new Float32Array(count * 4 * 4);
  strands.forEach((strand, index) => {
    for (let particle = 0; particle < perStrand; particle++) {
      const offset = index * perStrand + particle;
      const vertex = offset * 4;
      const start = (particle + unit()) / perStrand;
      const speed = 0.15 + unit() * 0.26;
      const length = 0.009 + 0.050 * Math.pow(unit(), 2.6);
      const scatter = unit() < 0.42 ? 0.12 + unit() * 0.17 : 0.025 + unit() * 0.07;
      for (let corner = 0; corner < 4; corner++) {
        const u = corner % 2 ? 1 : -1;
        const v = corner > 1 ? 1 : -1;
        writeVertex(buffers, vertex + corner, strand, u, v);
        motes.set([start, speed, length, scatter], (vertex + corner) * 4);
      }
      buffers.indices.set([vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3], offset * 6);
    }
  });
  return createMesh('energy motes', scene, parent, buffers, {
    vertexSource: particleVertex, fragmentSource: particleFragment,
  }, motes);
}

function countInRange(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : min;
}

export function createEnergy(scene: Scene, parent: TransformNode, theme: Palette, options: EnergyOptions) {
  const unit = seededUnit(126366);
  const strandCount = countInRange(options.tendrilCount, 1, 112);
  const particlesPerTendril = countInRange(options.particlesPerTendril, 0, 36);
  const strands = makeStrands(strandCount, unit);
  const materials = [createRibbons(scene, parent, strands)];
  if (particlesPerTendril > 0) {
    materials.push(createMotes(scene, parent, strands, particlesPerTendril, unit));
  }
  for (const material of materials) {
    material.setFloat('streamSpeed', options.streamSpeed);
  }

  function setColors(colors: Palette) {
    // The color controls supply sRGB. The shaders write linear light for
    // Babylon's bloom and tone mapping, so convert the palette once here.
    const primary = colors.primary.toLinearSpace();
    const accent = colors.accent.toLinearSpace();
    for (const material of materials) {
      material.setColor3('primary', primary);
      material.setColor3('accent', accent);
    }
  }

  function setIntensity(value: number) {
    const level = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    for (const material of materials) {
      material.setFloat('emissionLevel', level);
    }
  }

  setColors(theme);
  setIntensity(1);

  return {
    setColors,
    setIntensity,
    update(time: number, motion: number) {
      for (const material of materials) {
        material.setFloat('time', time);
        material.setFloat('motion', motion);
      }
    },
  };
}
