import * as THREE from "three";
import { bowlFieldTextureSize, maxWaterBowls } from "../config";
import { basinMaskChunk, gaussianChunk } from "./shader-chunks";
import type { SharedWaterUniforms } from "./uniforms";
import { sampleBowlWaterContact, type BowlWaterContact } from "../bowls/profile";
import type { BowlBody } from "../bowls/types";

// The bowl influence field (wake height, wake energy, meniscus, footprint).
// Each bowl is splatted as one instanced trapezoid quad covering its rim,
// bow wave, and wake trail, blended additively into the target. This keeps
// the cost proportional to the area bowls actually influence instead of
// evaluating every bowl at every texel (100 bowls x 384^2 texels).
export type BowlField = {
  update: (bowls: BowlBody[]) => void;
  dispose: () => void;
};

type BowlFieldDeps = {
  renderer: THREE.WebGLRenderer;
  uniforms: SharedWaterUniforms;
};

const bowlFieldOptions = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

const bowlFieldVertexShader = `
  attribute vec4 aBowlData;
  attribute vec3 aBowlVelocity;

  uniform vec4 uSimWorld;

  varying vec2 vWorld;
  varying vec4 vBowlData;
  varying vec2 vDirection;
  varying vec2 vSplatUv;
  varying float vContactVisibility;

  void main() {
    vec2 center = aBowlData.xy;
    float radius = max(aBowlData.z, 0.001);
    float speed = length(aBowlVelocity.xy);
    vec2 direction = speed > 0.0001 ? aBowlVelocity.xy / speed : vec2(1.0, 0.0);
    vec2 tangent = vec2(-direction.y, direction.x);

    // Trapezoid extents sized to the influence terms in the fragment
    // shader: rim + bow crest ahead, the exponential wake trail behind,
    // and a lateral flare that follows the V-wake opening angle.
    float aheadExtent = radius * 1.6 + 0.30;
    // Still bowls only need a compact contact patch.
    float behindExtent = mix(aheadExtent, (radius * 3.15 + 1.15) * 2.2, smoothstep(0.0, 0.08, aBowlData.w));
    float frontHalfWidth = radius * 1.7 + 0.42;
    float backHalfWidth = frontHalfWidth + behindExtent * 0.75;

    float t = position.y * 0.5 + 0.5;
    float along = mix(-behindExtent, aheadExtent, t);
    float halfWidth = mix(backHalfWidth, frontHalfWidth, t);
    vec2 world = center + direction * along + tangent * (position.x * halfWidth);

    vWorld = world;
    vBowlData = aBowlData;
    vDirection = direction;
    vSplatUv = position.xy * 0.5 + 0.5;
    vContactVisibility = aBowlVelocity.z;

    vec2 simUv = (world - uSimWorld.xy) / max(uSimWorld.zw, vec2(0.001));
    gl_Position = vec4(simUv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const bowlFieldFragmentShader = `
  precision highp float;

  uniform vec4 uPoolData;

  varying vec2 vWorld;
  varying vec4 vBowlData;
  varying vec2 vDirection;
  varying vec2 vSplatUv;
  varying float vContactVisibility;

  ${gaussianChunk}
  ${basinMaskChunk}

  void main() {
    vec2 p = vWorld;
    // Finite support: fade to zero before the rasterized quad ends so the
    // slope prepass never differentiates a hard wake boundary.
    vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.06), vSplatUv)
      * (1.0 - smoothstep(vec2(0.94), vec2(1.0), vSplatUv));
    float mask = basinMask(p) * vContactVisibility * edgeFade.x * edgeFade.y;
    vec2 center = vBowlData.xy;
    float radius = vBowlData.z;
    float wakeStrength = vBowlData.w;
    vec2 direction = vDirection;
    vec2 tangent = vec2(-direction.y, direction.x);
    vec2 offset = p - center;
    float d = length(offset);
    float rimWidth = 0.036 + radius * 0.034;
    float rim = gaussianBand(d, radius, rimWidth);
    float ahead = dot(offset, direction);
    float behind = -ahead;
    float activeBehind = max(behind, 0.0);
    float across = dot(offset, tangent);
    float motion = smoothstep(0.10, 0.86, wakeStrength);
    float flow = wakeStrength * (0.46 + motion * 0.54);

    float bowCrest = gaussianBand(ahead, radius * 0.82, 0.058 + radius * 0.070);
    bowCrest *= expFalloff(across, radius * 0.96 + 0.12) * flow;

    float bowTrough = gaussianBand(ahead, radius * 0.20, radius * 0.48 + 0.10);
    bowTrough *= expFalloff(across, radius * 1.12 + 0.14) * flow;

    float sideShoulder = gaussianBand(abs(across), radius * (0.78 + motion * 0.10), 0.056 + radius * 0.052);
    sideShoulder *= gaussianBand(ahead, radius * 0.02, radius * 0.82 + 0.15) * flow;

    float sternTrough = gaussianBand(behind, radius * 0.58, radius * 0.52 + 0.12);
    sternTrough *= expFalloff(across, radius * 0.62 + 0.16) * flow;

    float trail = smoothstep(0.02, radius * 0.42 + 0.16, behind);
    trail *= exp(-activeBehind / (radius * 3.15 + 1.15)) * flow;

    float vLine = abs(across) - activeBehind * (0.38 + motion * 0.13);
    float vWake = expFalloff(vLine, 0.064 + radius * 0.042 + activeBehind * 0.016);
    vWake *= trail;

    float shearLine = abs(across) - activeBehind * (0.54 + motion * 0.10);
    float shearWake = expFalloff(shearLine, 0.095 + radius * 0.052 + activeBehind * 0.018);
    shearWake *= trail * motion;

    float transverseWake = expFalloff(across, radius * 0.44 + activeBehind * 0.18 + 0.16);
    transverseWake *= trail * motion;

    float wakeWave = vWake * (0.018 + motion * 0.008)
      + shearWake * (0.010 + motion * 0.006)
      + transverseWake * (0.012 + motion * 0.006);

    float wakeHeight = rim * 0.012
      + bowCrest * 0.030
      - bowTrough * 0.014
      + sideShoulder * 0.012
      - sternTrough * 0.020
      + wakeWave;
    float wakeEnergy = rim * 0.105
      + bowCrest * 0.180
      + bowTrough * 0.085
      + sideShoulder * 0.105
      + sternTrough * 0.130
      + vWake * 0.180
      + shearWake * 0.150
      + transverseWake * 0.110;
    float meniscus = rim * (0.56 + wakeStrength * 0.30) + bowCrest * 0.16 + sideShoulder * 0.08;
    float footprint = 1.0 - smoothstep(radius - rimWidth * 0.35, radius + rimWidth * 0.20, d);

    gl_FragColor = vec4(
      clamp(wakeHeight * mask, -1.0, 1.0),
      clamp(wakeEnergy * mask, 0.0, 2.0),
      clamp(meniscus * mask, 0.0, 2.0),
      clamp(footprint * mask, 0.0, 1.0)
    );
  }
`;

function createBowlSplatGeometry() {
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(2, 2);
  geometry.setIndex(quad.getIndex());
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.instanceCount = 0;

  const bowlData = new Float32Array(maxWaterBowls * 4);
  const bowlVelocity = new Float32Array(maxWaterBowls * 3);
  const bowlDataAttribute = new THREE.InstancedBufferAttribute(bowlData, 4);
  const bowlVelocityAttribute = new THREE.InstancedBufferAttribute(bowlVelocity, 3);
  bowlDataAttribute.setUsage(THREE.DynamicDrawUsage);
  bowlVelocityAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aBowlData", bowlDataAttribute);
  geometry.setAttribute("aBowlVelocity", bowlVelocityAttribute);
  return { geometry, bowlDataAttribute, bowlVelocityAttribute };
}

export function createBowlField({ renderer, uniforms }: BowlFieldDeps): BowlField {
  const target = new THREE.WebGLRenderTarget(
    bowlFieldTextureSize,
    bowlFieldTextureSize,
    bowlFieldOptions,
  );
  target.texture.name = "Basin bowl influence field";
  // The target never ping-pongs, so the composite passes can bind it once.
  uniforms.uBowlFieldMap.value = target.texture;

  const {
    geometry: splatGeometry,
    bowlDataAttribute,
    bowlVelocityAttribute,
  } = createBowlSplatGeometry();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSimWorld: uniforms.uSimWorld,
      uPoolData: uniforms.uPoolData,
    },
    vertexShader: bowlFieldVertexShader,
    fragmentShader: bowlFieldFragmentShader,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const fieldScene = new THREE.Scene();
  const fieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fieldMesh = new THREE.Mesh(splatGeometry, material);
  fieldMesh.frustumCulled = false;
  fieldScene.add(fieldMesh);

  const previousClearColor = new THREE.Color();
  const contact: BowlWaterContact = { radius: 0, visibility: 0 };

  return {
    update(bowls: BowlBody[]) {
      const visibleBowlCount = Math.min(bowls.length, maxWaterBowls);
      let splatCount = 0;
      for (let i = 0; i < visibleBowlCount; i += 1) {
        const bowl = bowls[i];
        sampleBowlWaterContact(bowl.radius, bowl.mesh.position.y, contact);
        if (contact.visibility <= 0.001 || contact.radius <= 0) {
          continue;
        }
        const wakeStrength = THREE.MathUtils.clamp(bowl.waterVelocity.length() * 8.5, 0, 1);
        bowlDataAttribute.array[splatCount * 4] = bowl.mesh.position.x;
        bowlDataAttribute.array[splatCount * 4 + 1] = bowl.mesh.position.z;
        bowlDataAttribute.array[splatCount * 4 + 2] = contact.radius;
        bowlDataAttribute.array[splatCount * 4 + 3] = wakeStrength;
        bowlVelocityAttribute.array[splatCount * 3] = bowl.waterVelocity.x;
        bowlVelocityAttribute.array[splatCount * 3 + 1] = bowl.waterVelocity.y;
        bowlVelocityAttribute.array[splatCount * 3 + 2] = contact.visibility;
        splatCount += 1;
      }
      bowlDataAttribute.needsUpdate = true;
      bowlVelocityAttribute.needsUpdate = true;
      splatGeometry.instanceCount = splatCount;

      renderer.getClearColor(previousClearColor);
      const previousClearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
      renderer.render(fieldScene, fieldCamera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
    },

    dispose() {
      target.dispose();
      material.dispose();
      splatGeometry.dispose();
    },
  };
}
