import * as THREE from "three";
import { bowlFieldTextureSize, maxWaterBowls } from "../config";
import { renderer } from "../core/stage";
import { waterUniforms } from "./uniforms";

const bowlFieldOptions = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

export const bowlFieldTarget = new THREE.WebGLRenderTarget(
  bowlFieldTextureSize,
  bowlFieldTextureSize,
  bowlFieldOptions,
);
bowlFieldTarget.texture.name = "Basin bowl influence field";
waterUniforms.uBowlFieldMap.value = bowlFieldTarget.texture;

const bowlFieldUniforms: Record<string, THREE.IUniform> = {
  uSimWorld: waterUniforms.uSimWorld,
  uPoolData: waterUniforms.uPoolData,
  uBowlData: waterUniforms.uBowlData,
  uBowlVelocity: waterUniforms.uBowlVelocity,
  uBowlCount: waterUniforms.uBowlCount,
};

export const bowlFieldMaterial = new THREE.ShaderMaterial({
  uniforms: bowlFieldUniforms,
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    uniform vec4 uSimWorld;
    uniform vec4 uPoolData;
    uniform vec4 uBowlData[${maxWaterBowls}];
    uniform vec4 uBowlVelocity[${maxWaterBowls}];
    uniform int uBowlCount;

    varying vec2 vUv;

    float gaussianBand(float value, float center, float width) {
      return exp(-pow((value - center) / max(width, 0.001), 2.0));
    }

    float basinMask(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float softness = clamp(uPoolData.w * 0.22, 0.060, 0.180);
      float d = length(p - uPoolData.xy);
      return 1.0 - smoothstep(radius - softness, radius, d);
    }

    void main() {
      vec2 p = uSimWorld.xy + vUv * uSimWorld.zw;
      float mask = basinMask(p);
      if (mask <= 0.001) {
        gl_FragColor = vec4(0.0);
        return;
      }

      float wakeHeight = 0.0;
      float wakeEnergy = 0.0;
      float meniscus = 0.0;
      float footprint = 0.0;

      for (int i = 0; i < ${maxWaterBowls}; i++) {
        if (i >= uBowlCount) {
          break;
        }

        vec4 data = uBowlData[i];
        vec2 center = data.xy;
        float radius = data.z;
        float wakeStrength = data.w;
        if (radius <= 0.0) {
          continue;
        }

        vec2 velocity = uBowlVelocity[i].xy;
        float speed = length(velocity);
        vec2 direction = speed > 0.0001 ? velocity / speed : vec2(1.0, 0.0);
        vec2 backDirection = -direction;
        vec2 tangent = vec2(-direction.y, direction.x);
        vec2 offset = p - center;
        float d = length(offset);
        float rimWidth = 0.036 + radius * 0.034;
        float rim = exp(-pow((d - radius) / rimWidth, 2.0));
        float ahead = dot(offset, direction);
        float behind = dot(offset, backDirection);
        float activeBehind = max(behind, 0.0);
        float across = dot(offset, tangent);
        float motion = smoothstep(0.10, 0.86, wakeStrength);
        float flow = wakeStrength * (0.46 + motion * 0.54);

        float bowCrest = gaussianBand(ahead, radius * 0.82, 0.058 + radius * 0.070);
        bowCrest *= exp(-pow(across / (radius * 0.96 + 0.12), 2.0)) * flow;

        float bowTrough = gaussianBand(ahead, radius * 0.20, radius * 0.48 + 0.10);
        bowTrough *= exp(-pow(across / (radius * 1.12 + 0.14), 2.0)) * flow;

        float sideShoulder = gaussianBand(abs(across), radius * (0.78 + motion * 0.10), 0.056 + radius * 0.052);
        sideShoulder *= gaussianBand(ahead, radius * 0.02, radius * 0.82 + 0.15) * flow;

        float sternTrough = gaussianBand(behind, radius * 0.58, radius * 0.52 + 0.12);
        sternTrough *= exp(-pow(across / (radius * 0.62 + 0.16), 2.0)) * flow;

        float trail = smoothstep(0.02, radius * 0.42 + 0.16, behind);
        trail *= exp(-activeBehind / (radius * 3.15 + 1.15)) * flow;

        float vLine = abs(across) - activeBehind * (0.38 + motion * 0.13);
        float vWake = exp(-pow(vLine / (0.064 + radius * 0.042 + activeBehind * 0.016), 2.0));
        vWake *= trail;

        float shearLine = abs(across) - activeBehind * (0.54 + motion * 0.10);
        float shearWake = exp(-pow(shearLine / (0.095 + radius * 0.052 + activeBehind * 0.018), 2.0));
        shearWake *= trail * motion;

        float transverseWake = exp(-pow(across / (radius * 0.44 + activeBehind * 0.18 + 0.16), 2.0));
        transverseWake *= trail * motion;

        float wakeWave = vWake * (0.018 + motion * 0.008)
          + shearWake * (0.010 + motion * 0.006)
          + transverseWake * (0.012 + motion * 0.006);

        wakeHeight += rim * 0.012
          + bowCrest * 0.030
          - bowTrough * 0.014
          + sideShoulder * 0.012
          - sternTrough * 0.020
          + wakeWave;
        wakeEnergy += rim * 0.105
          + bowCrest * 0.180
          + bowTrough * 0.085
          + sideShoulder * 0.105
          + sternTrough * 0.130
          + vWake * 0.180
          + shearWake * 0.150
          + transverseWake * 0.110;
        meniscus += rim * (0.56 + wakeStrength * 0.30) + bowCrest * 0.16 + sideShoulder * 0.08;
        footprint = max(footprint, 1.0 - smoothstep(radius * 0.72, radius * 0.98, d));
      }

      gl_FragColor = vec4(
        clamp(wakeHeight * mask, -1.0, 1.0),
        clamp(wakeEnergy * mask, 0.0, 2.0),
        clamp(meniscus * mask, 0.0, 2.0),
        clamp(footprint * mask, 0.0, 1.0)
      );
    }
  `,
});

const bowlFieldScene = new THREE.Scene();
const bowlFieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
export const bowlFieldQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  bowlFieldMaterial,
);
bowlFieldScene.add(bowlFieldQuad);

export function updateBowlField() {
  renderer.setRenderTarget(bowlFieldTarget);
  renderer.render(bowlFieldScene, bowlFieldCamera);
  renderer.setRenderTarget(null);
  waterUniforms.uBowlFieldMap.value = bowlFieldTarget.texture;
}

export function disposeBowlField() {
  bowlFieldTarget.dispose();
  bowlFieldMaterial.dispose();
  bowlFieldQuad.geometry.dispose();
}
