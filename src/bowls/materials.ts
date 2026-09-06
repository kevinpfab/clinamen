import * as THREE from "three";
import {
  bowlImpactColorIntensity,
  bowlImpactInwardReachScale,
  bowlImpactRimInnerRadius,
  waterPlaneY,
} from "../config";
import type { SharedWaterUniforms } from "../water/uniforms";
import { porcelainSurface } from "./porcelain";
import {
  gaussianChunk,
  simulationUvChunk,
} from "../water/shader-chunks";

// Porcelain bowl materials plus the water-reflection and resonance-pulse
// shaders. The reflection reads the shared water uniforms, so the whole set is
// built per app rather than at module scope.
export type BowlMaterials = {
  // Shared by every instanced reflection mesh; the only material here bound to
  // the water uniforms.
  reflection: THREE.ShaderMaterial;
  createInstancedPorcelain: () => THREE.MeshPhysicalMaterial;
  createResonance: () => THREE.ShaderMaterial;
  createHeroResonance: () => THREE.ShaderMaterial;
  dispose: () => void;
};

const porcelainPulseWarmColor = new THREE.Color(0xff9f72);
const porcelainPulseCoolColor = new THREE.Color(0x70f4ff);
export const bowlResonancePulseLifetime = 0.68;
const bowlPulseEnvelopeLimit = 1.25 * bowlImpactColorIntensity;
const bowlPulseMixLimit = THREE.MathUtils.clamp(0.64 * bowlImpactColorIntensity, 0.64, 0.92);
const bowlPulseEmissiveBase = 0.18 * bowlImpactColorIntensity;
const bowlPulseEmissiveContact = 0.22 * bowlImpactColorIntensity;
const bowlPulseRoughnessLift = 0.155 * bowlImpactColorIntensity;
const bowlRimInnerFeatherEnd = Math.min(0.96, bowlImpactRimInnerRadius + 0.035);
const bowlRimPulseStrengthLimit = 1.4 * bowlImpactColorIntensity;
const reflectionRefractionOffsetLimit = 0.115;
const reflectionEdgeFeatherMin = 0.055;
const reflectionEdgeFeatherMax = 0.135;

// The surface comes from porcelain.ts, which the asset generator shares; the
// emissive channel is the piece's own, driven by the resonance pulse below.
const porcelainSettings: THREE.MeshPhysicalMaterialParameters = {
  ...porcelainSurface,
  emissive: 0x000000,
  emissiveIntensity: 1,
};

function createInstancedPorcelainMaterial() {
  const material = new THREE.MeshPhysicalMaterial(porcelainSettings);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBowlPulseWarmColor = { value: porcelainPulseWarmColor };
    shader.uniforms.uBowlPulseCoolColor = { value: porcelainPulseCoolColor };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aBowlToneRatio;
attribute float aBowlPulseEnvelope;
attribute vec2 aBowlImpactDirection;
varying float vBowlToneRatio;
varying float vBowlPulseEnvelope;
varying vec2 vBowlLocalRadial;
varying vec2 vBowlImpactDirection;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vBowlToneRatio = aBowlToneRatio;
vBowlPulseEnvelope = aBowlPulseEnvelope;
vec2 bowlLocalOffset = position.xz;
vBowlLocalRadial = length(bowlLocalOffset) > 0.001 ? normalize(bowlLocalOffset) : vec2(1.0, 0.0);
vBowlImpactDirection = aBowlImpactDirection;
#include <begin_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uBowlPulseWarmColor;
uniform vec3 uBowlPulseCoolColor;
varying float vBowlToneRatio;
varying float vBowlPulseEnvelope;
varying vec2 vBowlLocalRadial;
varying vec2 vBowlImpactDirection;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float bowlPulseEnvelope = clamp(vBowlPulseEnvelope * ${bowlImpactColorIntensity.toFixed(3)}, 0.0, ${bowlPulseEnvelopeLimit.toFixed(3)});
vec2 bowlImpactDirection = length(vBowlImpactDirection) > 0.001
  ? normalize(vBowlImpactDirection)
  : vec2(1.0, 0.0);
vec2 bowlLocalRadial = length(vBowlLocalRadial) > 0.001
  ? normalize(vBowlLocalRadial)
  : bowlImpactDirection;
float bowlContactSide = smoothstep(-0.32, 0.82, dot(bowlLocalRadial, bowlImpactDirection));
float bowlBodyPulse = bowlPulseEnvelope * (0.24 + bowlContactSide * 0.52);
vec3 bowlPulseColor = mix(uBowlPulseWarmColor, uBowlPulseCoolColor, clamp(vBowlToneRatio, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, bowlPulseColor, clamp(bowlBodyPulse, 0.0, ${bowlPulseMixLimit.toFixed(3)}));`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - bowlPulseEnvelope * ${bowlPulseRoughnessLift.toFixed(3)}, 0.24, roughness);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += bowlPulseColor * bowlPulseEnvelope * (${bowlPulseEmissiveBase.toFixed(3)} + bowlContactSide * ${bowlPulseEmissiveContact.toFixed(3)});`,
      );
  };
  material.customProgramCacheKey = () => `basin-instanced-porcelain-v3-${bowlImpactColorIntensity}`;
  return material;
}

const reflectionVertexShader = `
    uniform float uTime;
    uniform sampler2D uWaveStateMap;
    uniform sampler2D uWaveDerivedMap;
    uniform vec4 uSimWorld;

    varying vec3 vWorldPosition;
    varying float vReflectionFade;
    varying float vWaterMotion;
    varying vec2 vRefractionOffset;

    ${simulationUvChunk}

    vec2 clampReflectionOffset(vec2 offset) {
      float distance = length(offset);
      float limit = ${reflectionRefractionOffsetLimit.toFixed(3)};
      return distance > limit ? offset * (limit / max(distance, 0.001)) : offset;
    }

    void main() {
      vec4 instancePosition = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        instancePosition = instanceMatrix * instancePosition;
      #endif
      vec4 worldPosition = modelMatrix * instancePosition;
      // Surface, caustics, and reflections see the same completed wave state.
      // Two cached samples replace ten neighbor reads and a second slope model.
      vec2 uv = clamp(simulationUv(worldPosition.xz), 0.001, 0.999);
      vec4 wave = texture2D(uWaveStateMap, uv);
      vec2 slope = texture2D(uWaveDerivedMap, uv).xy;
      vec2 shimmer = vec2(
        sin(worldPosition.z * 7.4 + uTime * 0.92) + sin((worldPosition.x + worldPosition.z) * 4.8 - uTime * 0.64),
        cos(worldPosition.x * 6.8 - uTime * 0.78) + sin((worldPosition.x - worldPosition.z) * 4.2 + uTime * 0.58)
      );
      float reflectionFade = smoothstep(-1.35, -0.04, worldPosition.y);
      float motion = clamp(abs(wave.x) * 1.8 + wave.z * 0.75 + length(slope) * 0.080, 0.0, 1.0);
      vec2 refractionOffset = slope * (0.058 + motion * 0.062) * (0.62 + reflectionFade * 0.46)
        + shimmer * (0.0025 + motion * 0.0065);
      refractionOffset = clampReflectionOffset(refractionOffset);
      worldPosition.xz += refractionOffset;

      vWorldPosition = worldPosition.xyz;
      vReflectionFade = reflectionFade;
      vWaterMotion = clamp(motion + length(refractionOffset) * 3.2 + length(shimmer) * 0.018, 0.0, 1.0);
      vRefractionOffset = refractionOffset;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

const reflectionFragmentShader = `
    precision highp float;

    uniform float uOpacity;
    uniform float uSceneDim;
    uniform vec4 uPoolData;

    varying vec3 vWorldPosition;
    varying float vReflectionFade;
    varying float vWaterMotion;
    varying vec2 vRefractionOffset;

    float reflectionPoolVisibility(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float edgeFeather = clamp(uPoolData.w * 0.20, ${reflectionEdgeFeatherMin.toFixed(3)}, ${reflectionEdgeFeatherMax.toFixed(3)});
      float distanceFromCenter = length(p - uPoolData.xy);
      return 1.0 - smoothstep(radius - edgeFeather, radius, distanceFromCenter);
    }

    void main() {
      // Only the real bowl above the water has a mirror image below it.
      // Clip in world space instead of shrinking submerged reflections.
      if (vWorldPosition.y >= ${waterPlaneY.toFixed(3)}) {
        discard;
      }
      vec3 poolBlue = vec3(0.000, 0.561, 0.776);
      vec3 bowlIvory = vec3(0.900, 0.880, 0.800);
      float body = clamp(vReflectionFade, 0.0, 1.0);
      float band = smoothstep(-1.08, -0.18, vWorldPosition.y) * (1.0 - smoothstep(-0.18, -0.02, vWorldPosition.y));
      float refractionBreakup = smoothstep(0.010, 0.090, length(vRefractionOffset));
      vec3 blueReflection = mix(poolBlue * 0.34, poolBlue * 1.02, body);
      vec3 ivoryReflection = mix(poolBlue * 0.46, bowlIvory, 0.34 + body * 0.30);
      vec3 color = mix(blueReflection, ivoryReflection, 0.46);
      color += mix(poolBlue, bowlIvory, 0.32) * band * 0.20;
      color = mix(color, poolBlue * 0.76, refractionBreakup * 0.16);
      float poolVisibility = reflectionPoolVisibility(vWorldPosition.xz);
      float waterlineFade = smoothstep(0.0, 0.012, ${waterPlaneY.toFixed(3)} - vWorldPosition.y);
      float alpha = uOpacity * waterlineFade * (0.46 + body * 0.64) * (1.0 - vWaterMotion * 0.18 - refractionBreakup * 0.12) * poolVisibility;
      if (alpha <= 0.001) {
        discard;
      }
      gl_FragColor = vec4(color * uSceneDim, alpha);
    }
`;

function createReflectionMaterial(uniforms: SharedWaterUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uWaveStateMap: uniforms.uWaveStateMap,
      uWaveDerivedMap: uniforms.uWaveDerivedMap,
      uSimWorld: uniforms.uSimWorld,
      uPoolData: uniforms.uPoolData,
      uSceneDim: uniforms.uSceneDim,
      uOpacity: { value: 0.5 },
    },
    vertexShader: reflectionVertexShader,
    fragmentShader: reflectionFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// The rim-flare fragment is shared: the instanced field rims feed it per-bowl
// state through attributes, the hero's intro rim feeds it through uniforms, but
// the flare itself renders identically.
const bowlResonanceFragmentShader = `
      precision highp float;

      varying vec2 vRadial;
      varying float vRadiusBand;
      varying float vRimProfile;
      varying vec4 vRimPulse;
      varying vec2 vImpactDirection;

      const float BASIN_PI = 3.14159265359;

      ${gaussianChunk}

      void main() {
        float age = vRimPulse.x;
        float lifetime = vRimPulse.y;
        float strength = vRimPulse.z;
        float toneRatio = vRimPulse.w;

        if (strength <= 0.001) {
          discard;
        }

        float progress = clamp(age / max(lifetime, 0.001), 0.0, 1.0);
        float attack = smoothstep(0.0, 0.045, age);
        float fade = pow(1.0 - progress, 0.96) * attack;
        if (fade <= 0.001) {
          discard;
        }
        float pulseStrength = clamp(strength * ${bowlImpactColorIntensity.toFixed(3)}, 0.0, ${bowlRimPulseStrengthLimit.toFixed(3)});

        vec2 impactDirection = length(vImpactDirection) > 0.001
          ? normalize(vImpactDirection)
          : vec2(1.0, 0.0);
        float contactAngle = acos(clamp(dot(vRadial, impactDirection), -1.0, 1.0));
        float travel = smoothstep(0.0, 0.82, progress) * BASIN_PI;
        float frontWidth = mix(0.240, 0.520, progress) + pulseStrength * 0.070;
        float leadingWave = expFalloff(contactAngle - travel, frontWidth);
        float contactSpark = expFalloff(contactAngle, 0.380) * (1.0 - smoothstep(0.0, 0.34, progress));
        float traveledAfterglow = 1.0 - smoothstep(travel - 0.100, travel + 0.420, contactAngle);
        traveledAfterglow *= smoothstep(0.025, 0.220, progress);
        float circumferencePulse = leadingWave * 1.86 + traveledAfterglow * 0.94 + contactSpark * 1.82;
        float inwardProgress = smoothstep(0.0, 0.72, progress);
        float inwardReach = (mix(0.030, 0.105, inwardProgress) + pulseStrength * 0.012) * ${bowlImpactInwardReachScale.toFixed(3)};
        float insideDistance = max(1.0 - vRadiusBand, 0.0);
        float rimCore = 1.0 - smoothstep(inwardReach * 0.62, inwardReach, insideDistance);
        float innerFeather = smoothstep(${bowlImpactRimInnerRadius.toFixed(3)}, ${bowlRimInnerFeatherEnd.toFixed(3)}, vRadiusBand);
        // Fade at the actual end of the curved band, independent of radius
        // or the hero's finer tessellation.
        float outerFeather = 1.0 - smoothstep(0.85, 1.0, vRimProfile);
        float shimmer = 0.92
          + sin(atan(vRadial.y, vRadial.x) * 10.0 + age * 8.2 + toneRatio * BASIN_PI) * 0.08;

        float alpha = rimCore
          * innerFeather
          * outerFeather
          * circumferencePulse
          * fade
          * shimmer
          * mix(1.26, 2.56, pulseStrength / ${bowlRimPulseStrengthLimit.toFixed(3)})
          * ${bowlImpactColorIntensity.toFixed(3)};

        vec3 low = vec3(1.000, 0.515, 0.320);
        vec3 high = vec3(0.260, 0.965, 1.000);
        vec3 color = mix(low, high, toneRatio);
        color += vec3(1.0) * clamp((leadingWave * 0.55 + contactSpark * 0.88 + traveledAfterglow * 0.22) * fade, 0.0, 0.46);

        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
      }
    `;

const bowlResonanceMaterialSettings: THREE.ShaderMaterialParameters = {
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: true,
  side: THREE.DoubleSide,
  toneMapped: false,
};

function createBowlResonanceMaterial() {
  return new THREE.ShaderMaterial({
    ...bowlResonanceMaterialSettings,
    vertexShader: `
      precision highp float;

      attribute vec4 aRimPulse;
      attribute vec2 aRimImpactDirection;

      varying vec2 vRadial;
      varying float vRadiusBand;
      varying float vRimProfile;
      varying vec4 vRimPulse;
      varying vec2 vImpactDirection;

      void main() {
        vec2 rim = position.xz;
        float radius = max(length(rim), 0.001);
        vRadial = rim / radius;
        vRadiusBand = radius;
        vRimProfile = uv.y;
        vRimPulse = aRimPulse;
        vImpactDirection = aRimImpactDirection;
        vec4 instancePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          instancePosition = instanceMatrix * instancePosition;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
      }
    `,
    fragmentShader: bowlResonanceFragmentShader,
  });
}

// The intro's dedicated hero rim is a single non-instanced mesh, so its pulse
// state arrives as uniforms rather than per-instance attributes.
function createBowlHeroResonanceMaterial() {
  return new THREE.ShaderMaterial({
    ...bowlResonanceMaterialSettings,
    uniforms: {
      uRimPulse: { value: new THREE.Vector4(0, 1, 0, 0) },
      uRimImpactDirection: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: `
      precision highp float;

      uniform vec4 uRimPulse;
      uniform vec2 uRimImpactDirection;

      varying vec2 vRadial;
      varying float vRadiusBand;
      varying float vRimProfile;
      varying vec4 vRimPulse;
      varying vec2 vImpactDirection;

      void main() {
        vec2 rim = position.xz;
        float radius = max(length(rim), 0.001);
        vRadial = rim / radius;
        vRadiusBand = radius;
        vRimProfile = uv.y;
        vRimPulse = uRimPulse;
        vImpactDirection = uRimImpactDirection;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: bowlResonanceFragmentShader,
  });
}

export function createBowlMaterials(uniforms: SharedWaterUniforms): BowlMaterials {
  const reflection = createReflectionMaterial(uniforms);

  return {
    reflection,
    createInstancedPorcelain: createInstancedPorcelainMaterial,
    createResonance: createBowlResonanceMaterial,
    createHeroResonance: createBowlHeroResonanceMaterial,
    dispose() {
      reflection.dispose();
    },
  };
}
