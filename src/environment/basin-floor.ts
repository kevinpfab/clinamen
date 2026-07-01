import * as THREE from "three";
import {
  circularPoolSegments,
  maxFlowJets,
  maxRipples,
  waterSimulationSize,
} from "../config";
import { scene } from "../core/stage";
import { waterUniforms } from "../water/uniforms";

// The shaded basin floor seen through the translucent water.
export const basinFloorMaterial = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uHeightMap;
    uniform sampler2D uBowlFieldMap;
    uniform sampler2D uInteractionFieldMap;
    uniform vec4 uSimWorld;
    uniform vec4 uPoolData;
    uniform vec4 uRippleCenters[${maxRipples}];
    uniform vec4 uRippleData[${maxRipples}];
    uniform int uRippleCount;
    uniform vec4 uFlowJetData[${maxFlowJets}];
    uniform vec4 uFlowJetParams[${maxFlowJets}];
    uniform int uFlowJetCount;

    varying vec2 vUv;
    varying vec3 vWorldPosition;

    const float BASIN_TAU = 6.28318530718;

    float hash21(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float basinMask(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float softness = clamp(uPoolData.w * 0.22, 0.060, 0.180);
      float d = length(p - uPoolData.xy);
      return 1.0 - smoothstep(radius - softness, radius, d);
    }

    float basinDepthField(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float normalizedRadius = length(p - uPoolData.xy) / radius;
      return 1.0 - smoothstep(0.52, 1.0, normalizedRadius);
    }

    float basinEdgeField(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float normalizedRadius = length(p - uPoolData.xy) / radius;
      return smoothstep(0.72, 1.0, normalizedRadius);
    }

    vec2 simulationUv(vec2 p) {
      return (p - uSimWorld.xy) / max(uSimWorld.zw, vec2(0.001));
    }

    vec4 sampledBowlField(vec2 p) {
      return texture2D(uBowlFieldMap, clamp(simulationUv(p), 0.001, 0.999));
    }

    vec4 sampledInteractionField(vec2 p) {
      return texture2D(uInteractionFieldMap, clamp(simulationUv(p), 0.001, 0.999));
    }

    vec3 simulatedStateAtUv(vec2 uv) {
      vec2 safeUv = clamp(uv, 0.001, 0.999);
      vec2 p = uSimWorld.xy + safeUv * uSimWorld.zw;
      return texture2D(uHeightMap, safeUv).rgb * basinMask(p);
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

    vec3 explicitRippleDistortion(vec2 p, out vec2 directionWarp) {
      float height = 0.0;
      float slope = 0.0;
      float energy = 0.0;
      directionWarp = vec2(0.0);

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
        float fade = pow(1.0 - progress, 1.55) * smoothstep(0.0, 0.055, age);

        if (shape > 0.5) {
          float motion = clamp(directionLength - 1.0, 0.0, 1.0);
          float behind = max(-dot(offset, direction), 0.0);
          float across = dot(offset, tangent);
          float radiusHint = 0.24 + strength * 0.42 + motion * 0.22;
          float travel = age * (0.92 + strength * 0.26 + motion * 0.34);
          float packetWidth = radiusHint * (0.82 + motion * 0.24) + progress * 0.36;
          float packet = exp(-pow((behind - travel) / max(packetWidth, 0.001), 2.0));
          float wakeWidth = radiusHint * (0.34 + progress * 0.32) + behind * 0.030;
          float divergentLine = abs(across) - behind * mix(0.36, 0.52, motion);
          float divergent = exp(-pow(divergentLine / max(wakeWidth, 0.001), 2.0));
          divergent *= smoothstep(0.0, radiusHint * 0.45 + 0.055, behind);
          divergent *= exp(-behind / (3.0 + motion * 1.55)) * packet * fade;
          float transverse = exp(-pow(across / max(radiusHint * 1.25 + behind * 0.16, 0.001), 2.0));
          transverse *= smoothstep(0.0, radiusHint * 0.52 + 0.065, behind);
          transverse *= exp(-behind / (2.4 + motion * 1.2)) * packet * fade;
          float side = across < 0.0 ? -1.0 : 1.0;
          float amplitude = strength * (0.026 + motion * 0.016);
          vec2 localWarp = (-direction * transverse * 0.70 + tangent * side * divergent * 0.55) * amplitude;
          directionWarp += localWarp;
          height += dot(localWarp, direction) * 0.35;
          slope += (divergent + transverse) * strength * 0.42;
          energy += (divergent + transverse) * strength * 0.36;
          continue;
        }

        float d = length(offset);
        vec2 radial = d > 0.001 ? offset / d : direction;
        float waveSpeed = 1.08 + strength * 0.42;
        float travel = age * waveSpeed;
        float packetWidth = 0.130 + progress * 0.220 + strength * 0.036;
        float signedDistance = d - travel;
        float packet = exp(-pow(signedDistance / max(packetWidth, 0.001), 2.0));
        float crest = exp(-pow(signedDistance / max(packetWidth * 0.42, 0.001), 2.0));
        float trough = exp(-pow((signedDistance + packetWidth * 0.64) / max(packetWidth * 0.58, 0.001), 2.0));
        float carrier = sin(signedDistance * mix(28.0, 18.0, progress));
        float ripple = (crest - trough * 0.72 + carrier * packet * 0.12) * strength * fade;
        float distanceDamp = inversesqrt(1.0 + d * 0.78);
        directionWarp += radial * ripple * distanceDamp * 0.046;
        height += ripple * distanceDamp * 0.12;
        slope += abs(ripple) * distanceDamp * 0.82;
        energy += abs(ripple) * distanceDamp;
      }

      return vec3(height, slope, energy);
    }

    vec3 flowJetDistortion(vec2 p, out vec2 flowWarp) {
      float height = 0.0;
      float slope = 0.0;
      float energy = 0.0;
      flowWarp = vec2(0.0);

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
        float downstream = smoothstep(-radius * 0.16, radius * 0.62, along);
        float activeAlong = max(along, 0.0);
        float lateralSpread = radius * (0.86 + activeAlong * 0.085);
        float centerEnvelope = downstream
          * exp(-pow(across / max(lateralSpread, 0.001), 2.0))
          * exp(-activeAlong / (radius * 7.8));
        float shoulderDistance = abs(across) - radius * (0.72 + activeAlong * 0.022);
        float shoulderEnvelope = downstream
          * exp(-pow(shoulderDistance / (radius * 0.38 + activeAlong * 0.014), 2.0))
          * exp(-activeAlong / (radius * 6.2));
        float nozzle = exp(-pow(length(offset) / (radius * 1.18), 2.0));
        float centerWave = sin(activeAlong / radius * 3.10 - uTime * 1.86 + phase * 1.71) * centerEnvelope;
        float shoulderWave = sin(activeAlong / radius * 5.20 - uTime * 2.42 + abs(across) / radius * 0.78 + phase) * shoulderEnvelope;
        float side = across < 0.0 ? -1.0 : 1.0;
        float force = strength * 30.0;

        flowWarp += direction * (centerWave * 0.058 + nozzle * 0.030) * force;
        flowWarp += tangent * side * shoulderWave * 0.040 * force;
        height += (centerWave * 0.052 + shoulderWave * 0.026 + nozzle * 0.021) * force;
        slope += (abs(centerWave) * 0.44 + abs(shoulderWave) * 0.34 + nozzle * 0.34) * force;
        energy += (centerEnvelope * 0.32 + shoulderEnvelope * 0.26 + nozzle * 0.48) * force;
      }

      return vec3(height, slope, energy);
    }

    vec2 floorWaterWarp(vec2 p, out float waveHeight, out float waveSlope, out float waveEnergy) {
      float simulatedHeightValue = 0.0;
      float simulationEnergy = 0.0;
      vec2 simulationSlopeValue = simulatedSlope(p, simulatedHeightValue, simulationEnergy);
      vec4 interaction = sampledInteractionField(p);
      float interactionStep = 0.050;
      vec2 interactionSlope = vec2(
        sampledInteractionField(p + vec2(interactionStep, 0.0)).x - sampledInteractionField(p - vec2(interactionStep, 0.0)).x,
        sampledInteractionField(p + vec2(0.0, interactionStep)).x - sampledInteractionField(p - vec2(0.0, interactionStep)).x
      ) / max(interactionStep * 2.0, 0.001);
      vec2 interactionWarp = -interactionSlope * (0.046 + clamp(interaction.z, 0.0, 1.0) * 0.034);
      vec4 bowl = sampledBowlField(p);
      waveHeight = simulatedHeightValue * 0.98 + interaction.x * 0.92 + bowl.x * 0.38;
      waveSlope = abs(simulatedHeightValue) * 1.90
        + simulationEnergy * 0.18
        + interaction.y * 0.92
        + bowl.y * 0.20;
      waveEnergy = simulationEnergy * 0.78
        + abs(simulatedHeightValue) * 0.90
        + interaction.z * 0.92
        + bowl.y * 0.46;
      float breakup = clamp(abs(waveHeight) * 1.45 + waveSlope * 0.12 + waveEnergy * 0.30, 0.0, 1.0);
      vec2 drift = vec2(
        valueNoise(p * 2.95 + vec2(uTime * 0.22, waveHeight * 5.4)),
        valueNoise(p * 2.70 + vec2(-uTime * 0.18, waveHeight * 4.6))
      ) - 0.5;
      vec2 fine = vec2(
        sin(p.y * 7.8 + uTime * 0.86 + waveHeight * 20.0),
        cos(p.x * 6.9 - uTime * 0.72 - waveHeight * 18.0)
      );
      return simulationSlopeValue * (0.078 + breakup * 0.060 + waveEnergy * 0.018)
        + interactionWarp * (1.12 + breakup * 0.36)
        + drift * (0.020 + breakup * 0.090)
        + fine * (0.003 + breakup * 0.023);
    }

    float floorBowlShadow(vec2 p, vec2 waterWarp, float waveHeight, float waveSlope, float waveEnergy) {
      float footprint = sampledBowlField(p + waterWarp * 0.62).a;
      float breakup = clamp(abs(waveHeight) * 0.75 + waveSlope * 0.080 + waveEnergy * 0.18, 0.0, 0.62);
      return clamp(footprint * (0.42 + breakup), 0.0, 0.72);
    }

    float floorCaustics(vec2 p, float waveEnergy, float waveSlope) {
      vec2 q = p * 0.82;
      q += vec2(
        valueNoise(p * 0.22 + vec2(uTime * 0.018, 2.0)),
        valueNoise(p * 0.20 + vec2(-4.0, -uTime * 0.015))
      ) * (0.64 + clamp(waveEnergy, 0.0, 1.0) * 0.24);
      float a = sin(q.x * 3.10 + sin(q.y * 2.00) * 0.44 + uTime * 0.08);
      float b = sin(dot(q, vec2(0.72, 0.86)) * 3.70 - uTime * 0.10);
      float c = sin(dot(q, vec2(-0.55, 0.96)) * 4.20 + uTime * 0.07);
      float strands = max(0.0, (a + b + c) * 0.333);
      float concentration = mix(5.8, 3.9, clamp(waveEnergy * 0.50 + waveSlope * 0.10, 0.0, 1.0));
      return pow(strands, concentration) * (0.030 + waveEnergy * 0.024 + waveSlope * 0.006);
    }

    void main() {
      vec2 p = vWorldPosition.xz;
      float waveHeight = 0.0;
      float waveSlope = 0.0;
      float waveEnergy = 0.0;
      vec2 warp = floorWaterWarp(p, waveHeight, waveSlope, waveEnergy);
      float shadow = floorBowlShadow(p, warp, waveHeight, waveSlope, waveEnergy);
      float depth = basinDepthField(p);
      float edge = basinEdgeField(p);
      float caustics = floorCaustics(p + warp * 1.35, waveEnergy, waveSlope);
      float surfaceVariation = valueNoise(p * 0.54 + vec2(uTime * 0.012, -uTime * 0.010)) - 0.5;

      vec3 deepBlue = vec3(0.000, 0.360, 0.500);
      vec3 basinBlue = vec3(0.030, 0.735, 0.855);
      vec3 cyanBlue = vec3(0.180, 0.940, 1.000);
      vec3 color = mix(deepBlue, basinBlue, 0.78 + depth * 0.16 + surfaceVariation * 0.022);
      color = mix(color, cyanBlue, 0.34 + depth * 0.16);
      color = mix(color, deepBlue * 0.96, edge * 0.08);
      color += vec3(0.86, 1.00, 0.96) * caustics * (1.08 + depth * 0.48);
      color += vec3(0.46, 0.96, 0.96) * clamp(waveEnergy * 0.046, 0.0, 0.105);
      color += vec3(0.000, 0.060, 0.070) * (0.72 + depth * 0.28);
      color = mix(color, vec3(0.000, 0.070, 0.105), shadow);
      color *= 1.0 - edge * 0.08;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
export const basinFloor = new THREE.Mesh(
  new THREE.CircleGeometry(1, circularPoolSegments),
  basinFloorMaterial,
);
basinFloor.rotation.x = -Math.PI / 2;
basinFloor.position.y = -0.58;
basinFloor.receiveShadow = false;
scene.add(basinFloor);

export function disposeBasinFloor() {
  scene.remove(basinFloor);
  basinFloor.geometry.dispose();
  basinFloorMaterial.dispose();
}
