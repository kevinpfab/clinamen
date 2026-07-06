import * as THREE from "three";
import { circularPoolSegments } from "../config";
import { scene } from "../core/stage";
import { waterUniforms } from "../water/uniforms";
import { noisePeriod } from "../water/noise-texture";

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
    uniform sampler2D uWaveStateMap;
    uniform sampler2D uWaveDetailMap;
    uniform sampler2D uWaveDerivedMap;
    uniform sampler2D uNoiseMap;
    uniform vec4 uSimWorld;
    uniform vec4 uPoolData;

    varying vec2 vUv;
    varying vec3 vWorldPosition;

    float valueNoise(vec2 p) {
      return texture2D(uNoiseMap, p * ${(1 / noisePeriod).toFixed(6)}).r;
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

    vec4 sampledWaveState(vec2 p) {
      return texture2D(uWaveStateMap, clamp(simulationUv(p), 0.001, 0.999));
    }

    vec4 sampledWaveDetail(vec2 p) {
      return texture2D(uWaveDetailMap, clamp(simulationUv(p), 0.001, 0.999));
    }

    vec4 sampledWaveDerived(vec2 p) {
      return texture2D(uWaveDerivedMap, clamp(simulationUv(p), 0.001, 0.999));
    }

    vec2 floorWaterWarp(vec2 p, out float waveHeight, out float waveSlope, out float waveEnergy) {
      vec4 waveState = sampledWaveState(p);
      vec2 combinedSlope = sampledWaveDerived(p).xy;
      waveHeight = waveState.x;
      waveSlope = waveState.y;
      waveEnergy = waveState.z;
      float breakup = clamp(abs(waveHeight) * 1.45 + waveSlope * 0.12 + waveEnergy * 0.30, 0.0, 1.0);
      vec2 drift = vec2(
        valueNoise(p * 2.95 + vec2(uTime * 0.22, waveHeight * 5.4)),
        valueNoise(p * 2.70 + vec2(-uTime * 0.18, waveHeight * 4.6))
      ) - 0.5;
      vec2 fine = vec2(
        sin(p.y * 7.8 + uTime * 0.86 + waveHeight * 20.0),
        cos(p.x * 6.9 - uTime * 0.72 - waveHeight * 18.0)
      );
      return combinedSlope * (0.15 + breakup * 0.10 + waveEnergy * 0.03)
        + drift * (0.020 + breakup * 0.090)
        + fine * (0.003 + breakup * 0.023);
    }

    float floorBowlShadow(vec2 p, vec2 waterWarp, float waveHeight, float waveSlope, float waveEnergy) {
      float footprint = sampledWaveDetail(p + waterWarp * 0.62).z;
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
      // Light focused by the actual wave field: expanding ripple rings project
      // matching caustic rings that travel with the wavefront, unlike the
      // procedural strands which only brighten with ambient wave energy.
      float waveCaustic = sampledWaveDerived(p + warp * 0.85).z;
      float surfaceVariation = valueNoise(p * 0.54 + vec2(uTime * 0.012, -uTime * 0.010)) - 0.5;

      vec3 deepBlue = vec3(0.000, 0.360, 0.500);
      vec3 basinBlue = vec3(0.030, 0.735, 0.855);
      vec3 cyanBlue = vec3(0.180, 0.940, 1.000);
      vec3 color = mix(deepBlue, basinBlue, 0.78 + depth * 0.16 + surfaceVariation * 0.022);
      color = mix(color, cyanBlue, 0.34 + depth * 0.16);
      color = mix(color, deepBlue * 0.96, edge * 0.08);
      color += vec3(0.86, 1.00, 0.96) * caustics * (1.08 + depth * 0.48);
      color += vec3(0.88, 1.00, 0.97) * waveCaustic * (0.30 + depth * 0.16);
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
