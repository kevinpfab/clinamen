import * as THREE from "three";
import {
  bowlImpactColorIntensity,
  bowlImpactInwardReachScale,
  bowlImpactRimInnerRadius,
  maxFlowJets,
  maxRipples,
  waterSimulationSize,
  waterPlaneY,
} from "../config";
import type { SharedWaterUniforms } from "../water/uniforms";
import { porcelainSurface } from "./porcelain";
import {
  basinMaskChunk,
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
    uniform sampler2D uHeightMap;
    uniform sampler2D uInteractionFieldMap;
    uniform vec4 uSimWorld;
    uniform vec4 uPoolData;
    uniform float uWaveSpeed;
    uniform vec4 uRippleCenters[${maxRipples}];
    uniform vec4 uRippleData[${maxRipples}];
    uniform int uRippleCount;
    uniform vec4 uFlowJetData[${maxFlowJets}];
    uniform vec4 uFlowJetParams[${maxFlowJets}];
    uniform int uFlowJetCount;

    varying vec3 vWorldPosition;
    varying float vReflectionFade;
    varying float vWaterMotion;
    varying vec2 vRefractionOffset;

    ${gaussianChunk}
    ${basinMaskChunk}
    ${simulationUvChunk}

    vec3 simulatedStateAtUv(vec2 uv) {
      vec2 safeUv = clamp(uv, 0.001, 0.999);
      vec2 p = uSimWorld.xy + safeUv * uSimWorld.zw;
      float mask = basinMask(p);
      return texture2D(uHeightMap, safeUv).rgb * mask;
    }

    vec2 simulatedSlope(vec2 p, out float height, out float energy) {
      vec2 uv = simulationUv(p);
      vec2 texel = vec2(${1 / waterSimulationSize});
      vec2 worldTexel = max(uSimWorld.zw * texel, vec2(0.001));
      vec3 center = simulatedStateAtUv(uv);
      float leftHeight = simulatedStateAtUv(uv - vec2(texel.x, 0.0)).r;
      float rightHeight = simulatedStateAtUv(uv + vec2(texel.x, 0.0)).r;
      float downHeight = simulatedStateAtUv(uv - vec2(0.0, texel.y)).r;
      float upHeight = simulatedStateAtUv(uv + vec2(0.0, texel.y)).r;
      height = center.r;
      energy = center.b;
      return vec2(leftHeight - rightHeight, downHeight - upHeight) / (worldTexel * 2.0);
    }

    vec4 interactionFieldAt(vec2 p) {
      return texture2D(uInteractionFieldMap, clamp(simulationUv(p), 0.001, 0.999));
    }

    vec2 interactionFieldRefraction(vec2 p, out float interactionEnergy) {
      float sampleStep = 0.050;
      vec4 center = interactionFieldAt(p);
      vec2 slope = vec2(
        interactionFieldAt(p + vec2(sampleStep, 0.0)).x - interactionFieldAt(p - vec2(sampleStep, 0.0)).x,
        interactionFieldAt(p + vec2(0.0, sampleStep)).x - interactionFieldAt(p - vec2(0.0, sampleStep)).x
      ) / max(sampleStep * 2.0, 0.001);
      interactionEnergy = center.z + abs(center.x) * 0.72 + center.w * 0.18;
      return -slope * (0.026 + clamp(interactionEnergy, 0.0, 1.0) * 0.030);
    }

    // The reflection's own reading of the ripple field. It cannot sample the
    // interaction field's height at vertex rate with enough precision to
    // recover a usable gradient, so it re-derives the wave envelopes directly
    // from the ripple uniforms — the same envelopes water/interaction-field.ts
    // integrates, at the same wave speed, fade, and widths, so a reflection
    // bends over the ring that is actually there.
    //
    // What it deliberately leaves out, because a reflected bowl only needs the
    // dominant bend and this runs per vertex: the recovery crest and tail of
    // the radial packet, the directional spread of the young front, the
    // compression pulse, and the valueNoise term that gives the water's rings
    // their organic edge (no noise source in this shader). Amplitudes below are
    // the reflection's own — they scale a world-space offset, not a height.
    vec2 explicitRippleRefraction(vec2 p, out float rippleEnergy) {
      vec2 refraction = vec2(0.0);
      rippleEnergy = 0.0;

      for (int i = 0; i < ${maxRipples}; i++) {
        if (i >= uRippleCount) {
          break;
        }

        vec2 center = uRippleCenters[i].xy;
        float age = uRippleData[i].x;
        float lifetime = max(uRippleData[i].y, 0.001);
        float strength = uRippleData[i].z;
        float shape = uRippleData[i].w;
        vec2 direction = uRippleCenters[i].zw;
        float directionLength = length(direction);
        direction = directionLength > 0.001 ? direction / directionLength : vec2(1.0, 0.0);
        vec2 tangent = vec2(-direction.y, direction.x);
        vec2 offset = p - center;
        float progress = clamp(age / lifetime, 0.0, 1.0);
        float ageGate = smoothstep(0.0, 0.055, age);

        if (shape > 0.5) {
          float motion = clamp(directionLength - 1.0, 0.0, 1.0);
          float behind = max(-dot(offset, direction), 0.0);
          float across = dot(offset, tangent);
          float fade = pow(1.0 - progress, 1.70) * ageGate;
          float radiusHint = 0.24 + strength * 0.42 + motion * 0.22;
          float travel = age * (0.92 + strength * 0.26 + motion * 0.34);
          float packetWidth = radiusHint * (0.82 + motion * 0.24) + progress * 0.36;
          float packet = expFalloff(behind - travel, packetWidth);
          float divergentWidth = radiusHint * (0.24 + progress * 0.32) + behind * 0.018;
          float divergentLine = abs(across) - behind * mix(0.36, 0.52, motion);
          float divergent = expFalloff(divergentLine, divergentWidth);
          divergent *= smoothstep(0.0, radiusHint * 0.42 + 0.055, behind);
          divergent *= exp(-behind / (3.00 + motion * 1.55)) * packet * fade;
          float transverseWidth = radiusHint * (1.18 + motion * 0.48) + behind * 0.19;
          float transverse = expFalloff(across, transverseWidth);
          transverse *= smoothstep(0.0, radiusHint * 0.55 + 0.070, behind);
          transverse *= exp(-behind / (2.30 + motion * 1.12)) * packet * fade;
          float side = across < 0.0 ? -1.0 : 1.0;
          float amplitude = strength * (0.026 + motion * 0.016);
          refraction += (-direction * transverse * 0.70 + tangent * side * divergent * 0.55) * amplitude;
          rippleEnergy += (divergent + transverse) * strength * 0.42;
          continue;
        }

        float d = length(offset);
        vec2 radial = d > 0.001 ? offset / d : direction;
        float fade = pow(1.0 - progress, 1.62) * ageGate;
        float travel = age * uWaveSpeed;
        float packetWidth = 0.130 + progress * 0.220 + strength * 0.036;
        float signedDistance = d - travel;
        float packet = expFalloff(signedDistance, packetWidth);
        float crest = expFalloff(signedDistance, packetWidth * 0.42);
        float trough = expFalloff(signedDistance + packetWidth * 0.64, packetWidth * 0.58);
        float carrier = sin(signedDistance * mix(28.0, 18.0, progress));
        float ripple = (crest - trough * 0.72 + carrier * packet * 0.12) * strength * fade;
        float distanceDamp = inversesqrt(1.0 + d * 0.78);
        refraction += radial * ripple * distanceDamp * 0.046;
        rippleEnergy += abs(ripple) * distanceDamp;
      }

      return refraction;
    }

    // The jet-wake counterpart, mirroring flowRippleField in
    // water/interaction-field.ts envelope for envelope and phase for phase. It
    // keeps the center and shoulder waves and the nozzle, and drops the
    // cross-ripple turbulence thread, which is below the resolution of a
    // reflection.
    vec2 flowJetRefraction(vec2 p, out float flowEnergy) {
      vec2 refraction = vec2(0.0);
      flowEnergy = 0.0;

      for (int i = 0; i < ${maxFlowJets}; i++) {
        if (i >= uFlowJetCount) {
          break;
        }

        vec4 jet = uFlowJetData[i];
        vec4 params = uFlowJetParams[i];
        vec2 source = jet.xy;
        vec2 direction = length(jet.zw) > 0.001 ? normalize(jet.zw) : vec2(1.0, 0.0);
        vec2 tangent = vec2(-direction.y, direction.x);
        float radius = max(params.x, 0.001);
        float strength = params.y;
        float phase = params.w;
        vec2 offset = p - source;
        float along = dot(offset, direction);
        float across = dot(offset, tangent);
        float downstream = smoothstep(-radius * 0.16, radius * 0.60, along);
        float activeAlong = max(along, 0.0);
        float lateralSpread = radius * (0.86 + activeAlong * 0.085);
        float centerEnvelope = downstream
          * expFalloff(across, lateralSpread)
          * exp(-activeAlong / (radius * 7.8));
        float shoulderDistance = abs(across) - radius * (0.72 + activeAlong * 0.022);
        float shoulderEnvelope = downstream
          * expFalloff(shoulderDistance, radius * 0.38 + activeAlong * 0.014)
          * exp(-activeAlong / (radius * 6.2));
        float nozzle = expFalloff(length(offset), radius * 1.18);
        float centerWave = sin(activeAlong / radius * 3.10 - uTime * 1.86 + phase * 1.71) * centerEnvelope;
        float shoulderWave = sin(activeAlong / radius * 5.20 - uTime * 2.42 + abs(across) / radius * 0.78 + phase) * shoulderEnvelope;
        float side = across < 0.0 ? -1.0 : 1.0;
        float force = strength * 30.0;

        refraction += direction * (centerWave * 0.058 + nozzle * 0.030) * force;
        refraction += tangent * side * shoulderWave * 0.040 * force;
        flowEnergy += (abs(centerWave) * 0.46 + abs(shoulderWave) * 0.34 + nozzle * 0.32) * force;
      }

      return refraction;
    }

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
      float height = 0.0;
      float simulationEnergy = 0.0;
      float interactionEnergy = 0.0;
      vec2 slope = simulatedSlope(worldPosition.xz, height, simulationEnergy);
      vec2 interactionRefraction = interactionFieldRefraction(worldPosition.xz, interactionEnergy);
      vec2 shimmer = vec2(
        sin(worldPosition.z * 7.4 + uTime * 0.92) + sin((worldPosition.x + worldPosition.z) * 4.8 - uTime * 0.64),
        cos(worldPosition.x * 6.8 - uTime * 0.78) + sin((worldPosition.x - worldPosition.z) * 4.2 + uTime * 0.58)
      );
      float reflectionFade = smoothstep(-1.35, -0.04, worldPosition.y);
      float motion = clamp(
          abs(height) * 1.8
            + simulationEnergy * 0.50
          + interactionEnergy * 1.12
          + length(slope) * 0.080,
        0.0,
        1.0
      );
      vec2 refractionOffset = slope * (0.034 + motion * 0.036) * (0.62 + reflectionFade * 0.46)
        + interactionRefraction * (1.04 + reflectionFade * 0.40)
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
      uHeightMap: uniforms.uHeightMap,
      uInteractionFieldMap: uniforms.uInteractionFieldMap,
      uSimWorld: uniforms.uSimWorld,
      uPoolData: uniforms.uPoolData,
      uWaveSpeed: uniforms.uWaveSpeed,
      uRippleCenters: uniforms.uRippleCenters,
      uRippleData: uniforms.uRippleData,
      uRippleCount: uniforms.uRippleCount,
      uFlowJetData: uniforms.uFlowJetData,
      uFlowJetParams: uniforms.uFlowJetParams,
      uFlowJetCount: uniforms.uFlowJetCount,
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

      uniform vec2 uOuterFeather;

      varying vec2 vRadial;
      varying float vRadiusBand;
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
        float outerFeather = 1.0 - smoothstep(uOuterFeather.x, uOuterFeather.y, vRadiusBand);
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
    // The flat field rims fade at the pool-facing edge, r = 1.
    uniforms: {
      uOuterFeather: { value: new THREE.Vector2(0.992, 1.0) },
    },
    vertexShader: `
      precision highp float;

      attribute vec4 aRimPulse;
      attribute vec2 aRimImpactDirection;

      varying vec2 vRadial;
      varying float vRadiusBand;
      varying vec4 vRimPulse;
      varying vec2 vImpactDirection;

      void main() {
        vec2 rim = position.xz;
        float radius = max(length(rim), 0.001);
        vRadial = rim / radius;
        vRadiusBand = radius;
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
      // The hero's 3D band curls past r = 1 over the rounded lip's outer face;
      // fade further out so that face lights and tapers softly at the edge
      // rather than being clipped at the pool line.
      uOuterFeather: { value: new THREE.Vector2(0.996, 1.018) },
    },
    vertexShader: `
      precision highp float;

      uniform vec4 uRimPulse;
      uniform vec2 uRimImpactDirection;

      varying vec2 vRadial;
      varying float vRadiusBand;
      varying vec4 vRimPulse;
      varying vec2 vImpactDirection;

      void main() {
        vec2 rim = position.xz;
        float radius = max(length(rim), 0.001);
        vRadial = rim / radius;
        vRadiusBand = radius;
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
