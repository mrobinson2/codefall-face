import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import type { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { Scene } from "@babylonjs/core/scene.js";

export function createBackdrop(scene: Scene) {
  const plane = CreatePlane("haze", { size: 2 }, scene);
  plane.isPickable = false;
  plane.alwaysSelectAsActiveMesh = true;

  // A screen-space backdrop keeps the stage dark even when the camera orbits.
  const material = new ShaderMaterial("haze", scene, {
    vertexSource: `
      precision highp float;
      attribute vec3 position;
      varying vec2 vUV;
      void main() {
        vUV = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }
    `,
    fragmentSource: `
      precision highp float;
      varying vec2 vUV;
      uniform float aspect;
      uniform vec3 primary;
      uniform vec3 accent;
      uniform float intensity;

      float haze(vec2 p) {
        return exp(-dot(p, p));
      }

      void main() {
        vec2 p = vUV - 0.5;
        p.x *= aspect;
        vec3 color = vec3(0.00016, 0.00018, 0.00026);
        color += 0.00062 * primary * haze((p + vec2(0.11, -0.01)) * vec2(3.4, 3.0));
        color += 0.00140 * accent * haze((p - vec2(0.14, 0.02)) * vec2(3.9, 3.5));

        gl_FragColor = vec4(color * intensity, 1.0);
      }
    `,
  }, { attributes: ["position"], uniforms: ["aspect", "primary", "accent", "intensity"] });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  plane.material = material;
  material.setFloat("intensity", 1);

  return {
    resize(aspect: number) {
      material.setFloat("aspect", aspect);
    },
    setIntensity(value: number) {
      material.setFloat("intensity", Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
    },
    setColors(theme: { primary: Color3; accent: Color3 }) {
      material.setColor3("primary", theme.primary.toLinearSpace());
      material.setColor3("accent", theme.accent.toLinearSpace());
    },
  };
}
