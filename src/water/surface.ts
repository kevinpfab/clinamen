import * as THREE from "three";
import { circularPoolSegments } from "../config";
import { scene } from "../core/stage";
import { waterUniforms } from "./uniforms";

// The brilliant-blue water surface: a circular plane driven by a custom shader
// that reads the simulation, bowl, and precomputed interaction fields.
export const waterMaterial = new THREE.ShaderMaterial({
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
    uniform vec4 uSimWorld;
    uniform vec4 uPoolData;
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

    float waveLayer(vec2 p, vec2 direction, float speed, float scale, float weight) {
      vec2 tangent = vec2(-direction.y, direction.x);
      float a = sin((dot(p, direction) * scale + uTime * speed) * BASIN_TAU);
      float b = cos((dot(p, tangent) * scale * 0.72 - uTime * speed * 0.62) * BASIN_TAU);
      return (a + b) * 0.5 * weight;
    }

    float baseSurface(vec2 p) {
      vec2 broadWarp = vec2(
        valueNoise(p * 0.145 + vec2(uTime * 0.012, 4.7)),
        valueNoise(p * 0.160 + vec2(-3.1, uTime * 0.010))
      ) - 0.5;
      vec2 fineWarp = vec2(
        valueNoise(p * 0.420 + vec2(8.2, -uTime * 0.022)),
        valueNoise(p * 0.390 + vec2(uTime * 0.018, -6.4))
      ) - 0.5;
      vec2 q = p + broadWarp * 0.86 + fineWarp * 0.14;
      float surface = 0.0;
      surface += waveLayer(q, normalize(vec2(1.0, 0.34)), 0.021, 0.058, 0.34);
      surface += waveLayer(q + vec2(2.4, -1.8), normalize(vec2(-0.42, 1.0)), 0.034, 0.108, 0.22);
      surface += waveLayer(q + vec2(-0.7, 2.1), normalize(vec2(0.80, -0.60)), 0.048, 0.174, 0.11);
      surface += (valueNoise(q * 0.58 + vec2(uTime * 0.014, -uTime * 0.018)) - 0.5) * 0.040;
      return surface;
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

    float basinDepthField(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float normalizedRadius = length(p - uPoolData.xy) / radius;
      return 1.0 - smoothstep(0.54, 1.02, normalizedRadius);
    }

    float basinEdgeField(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float normalizedRadius = length(p - uPoolData.xy) / radius;
      return smoothstep(0.74, 1.0, normalizedRadius);
    }

    vec2 shimmerSlope(vec2 p) {
      vec2 slope = vec2(0.0);
      vec2 d1 = normalize(vec2(0.92, 0.38));
      vec2 d2 = normalize(vec2(-0.42, 1.00));
      vec2 d3 = normalize(vec2(0.18, -0.98));
      float q1 = dot(p, d1) * 8.2 + uTime * 1.18;
      float q2 = dot(p + vec2(1.8, -0.7), d2) * 13.6 - uTime * 1.56;
      float q3 = dot(p + vec2(-0.4, 2.1), d3) * 21.5 + uTime * 2.18;
      float cell = valueNoise(p * 2.6 + vec2(uTime * 0.20, -uTime * 0.16));
      slope += d1 * cos(q1) * 0.050;
      slope += d2 * cos(q2 + cell * 1.45) * 0.033;
      slope += d3 * cos(q3 - cell * 2.10) * 0.020;
      slope += vec2(
        valueNoise(p * 6.4 + vec2(uTime * 0.54, 2.7)),
        valueNoise(p * 6.1 + vec2(-3.2, -uTime * 0.48))
      ) * 0.018 - vec2(0.009);
      return slope;
    }

    vec2 waterWarp(vec2 p, vec2 slope, float waveHeight, float waveSlope, float waveEnergy) {
      float breakup = clamp(abs(waveHeight) * 1.45 + waveSlope * 0.11 + waveEnergy * 0.26, 0.0, 1.0);
      vec2 drift = vec2(
        valueNoise(p * 2.95 + vec2(uTime * 0.22, waveHeight * 5.4)),
        valueNoise(p * 2.70 + vec2(-uTime * 0.18, waveHeight * 4.6))
      ) - 0.5;
      vec2 fine = vec2(
        sin(p.y * 7.8 + uTime * 0.86 + waveHeight * 20.0),
        cos(p.x * 6.9 - uTime * 0.72 - waveHeight * 18.0)
      );
      return slope * (0.18 + breakup * 0.16 + waveEnergy * 0.032)
        + drift * (0.014 + breakup * 0.064)
        + fine * (0.0025 + breakup * 0.018);
    }

    float underwaterShadowField(vec2 p, vec2 slope, float waveHeight, float waveSlope, float waveEnergy) {
      vec2 warp = waterWarp(p, slope, waveHeight, waveSlope, waveEnergy);
      float footprint = sampledWaveDetail(p + warp * 0.42).z;
      float breakup = clamp(abs(waveHeight) * 0.65 + waveSlope * 0.070 + waveEnergy * 0.16, 0.0, 0.50);
      return clamp(footprint * (0.18 + breakup), 0.0, 0.34);
    }

    float subtleCaustics(vec2 p, float waveEnergy, float slopeAmount) {
      vec2 q = p * 0.82;
      q += vec2(
        valueNoise(p * 0.22 + vec2(uTime * 0.018, 2.0)),
        valueNoise(p * 0.20 + vec2(-4.0, -uTime * 0.015))
      ) * (0.64 + clamp(waveEnergy, 0.0, 1.0) * 0.22);
      float a = sin(q.x * 3.10 + sin(q.y * 2.00) * 0.44 + uTime * 0.08);
      float b = sin(dot(q, vec2(0.72, 0.86)) * 3.70 - uTime * 0.10);
      float c = sin(dot(q, vec2(-0.55, 0.96)) * 4.20 + uTime * 0.07);
      float strands = max(0.0, (a + b + c) * 0.333);
      float concentration = mix(5.4, 3.8, clamp(waveEnergy * 0.52 + slopeAmount * 0.34, 0.0, 1.0));
      return pow(strands, concentration) * (0.012 + waveEnergy * 0.018 + slopeAmount * 0.010);
    }

    void main() {
      vec2 p = vWorldPosition.xz;
      vec4 waveState = sampledWaveState(p);
      vec4 waveDetail = sampledWaveDetail(p);
      float bowlOcclusion = clamp(waveDetail.z, 0.0, 1.0);
      float surface = baseSurface(p);
      float simulationEnergy = waveDetail.w;
      float basinDepth = basinDepthField(p);
      float basinEdge = basinEdgeField(p);
      float waveHeight = waveState.x;
      float waveSlope = waveState.y;
      float waveEnergy = waveState.z;
      float contactBase = waveState.w;
      float meniscus = clamp(waveDetail.y * (0.048 + waveEnergy * 0.006), 0.0, 0.18);
      float contactAccent = contactBase + meniscus;
      vec4 waveDerived = sampledWaveDerived(p);
      float foam = waveDerived.w;
      vec2 slope = waveDerived.xy + shimmerSlope(p);
      float slopeAmount = length(slope);
      vec3 normal = normalize(vec3(slope.x, 1.0, slope.y));
      vec3 lightDirection = normalize(vec3(-0.12, 0.99, 0.08));
      vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
      vec3 halfDirection = normalize(lightDirection + viewDirection);
      float directionalLight = clamp(dot(normal, lightDirection), 0.0, 1.0);
      float specular = pow(clamp(dot(normal, halfDirection), 0.0, 1.0), 118.0) * 0.44;
      float broadSpecular = pow(clamp(dot(normal, halfDirection), 0.0, 1.0), 22.0) * 0.045;
      float fresnel = pow(1.0 - clamp(dot(normal, viewDirection), 0.0, 1.0), 3.0);
      float causticLight = subtleCaustics(p + normal.xz * (0.20 + waveEnergy * 0.045), waveEnergy, slopeAmount);
      vec3 deepBlue = vec3(0.000, 0.180, 0.300);
      vec3 tealBlue = vec3(0.000, 0.440, 0.590);
      vec3 cyanBlue = vec3(0.000, 0.561, 0.776);
      vec3 highlight = vec3(0.700, 0.940, 0.900);
      float positiveCrest = max(waveHeight, 0.0);
      float negativeTrough = max(-waveHeight, 0.0);
      float whiteCrest = smoothstep(0.034, 0.180, positiveCrest) * clamp(positiveCrest * 0.92, 0.0, 0.20);
      whiteCrest += smoothstep(0.120, 0.640, waveSlope) * clamp(waveEnergy * 0.046, 0.0, 0.11);
      whiteCrest += smoothstep(0.24, 1.00, simulationEnergy + contactBase * 0.20) * clamp(slopeAmount * 0.020, 0.0, 0.055);
      whiteCrest += clamp(contactAccent * 0.21, 0.0, 0.12);
      whiteCrest += clamp(contactBase * 0.010 + waveEnergy * 0.030, 0.0, 0.10);
      whiteCrest += clamp(
        foam * (0.11 + valueNoise(p * 4.2 + vec2(uTime * 0.11, -uTime * 0.09)) * 0.10),
        0.0,
        0.15
      );
      float shimmer = surface * 0.22 + waveHeight * 0.48;
      float distanceFade = smoothstep(-5.0, 4.8, p.y);
      float glancing = smoothstep(0.18, 0.84, fresnel);
      float lightBand = smoothstep(0.60, 1.0, sin((p.x * 0.42 + p.y * 0.18) + uTime * 0.22) * 0.5 + 0.5);
      vec3 color = mix(deepBlue, tealBlue, 0.62 + basinDepth * 0.18 + shimmer * 0.10 + distanceFade * 0.08);
      color = mix(color, cyanBlue, 0.19 + directionalLight * 0.08 + glancing * 0.15 + basinDepth * 0.04);
      color = mix(color, deepBlue * 0.84, basinEdge * 0.16);
      color += highlight * (
        0.012
        + lightBand * 0.008
        + specular * (0.78 + waveEnergy * 0.08)
        + broadSpecular
        + fresnel * 0.040
        + causticLight * (0.82 + basinDepth * 0.52)
        + slopeAmount * 0.016
      );
      color += highlight * clamp(contactBase * 0.014, 0.0, 0.10);
      color += vec3(0.76, 1.0, 0.96) * clamp(waveEnergy * 0.026, 0.0, 0.14);
      color += vec3(0.72, 0.98, 0.94) * meniscus * 0.25;
      color -= deepBlue * clamp(negativeTrough * 0.24, 0.0, 0.20);
      color -= deepBlue * basinEdge * clamp(0.040 + waveEnergy * 0.018, 0.0, 0.12);
      color *= 1.0 + surface * 0.018;
      float underwaterShadow = underwaterShadowField(p, slope, waveHeight, waveSlope, waveEnergy);
      vec3 shadowColor = mix(deepBlue * 0.78, vec3(0.000, 0.160, 0.220), 0.48);
      color = mix(color, shadowColor, underwaterShadow * 0.28);
      vec3 crestColor = vec3(0.900, 0.990, 0.985);
      float crestMix = clamp(whiteCrest, 0.0, 0.30);
      color = mix(color, crestColor, crestMix);
      color += crestColor * clamp(whiteCrest * 0.09 + causticLight * 0.14 + meniscus * 0.035, 0.0, 0.12);

      float waterAlpha = clamp(
        0.70
          + basinDepth * 0.035
          + basinEdge * 0.040
          + fresnel * 0.18
          + waveSlope * 0.018
          + underwaterShadow * 0.015,
        0.66,
        0.95
      );
      waterAlpha *= 1.0 - bowlOcclusion;
      gl_FragColor = vec4(color, waterAlpha);
    }
  `,
  transparent: true,
  depthWrite: false,
});

export const water = new THREE.Mesh(
  new THREE.CircleGeometry(1, circularPoolSegments),
  waterMaterial,
);
water.rotation.x = -Math.PI / 2;
water.receiveShadow = false;
water.renderOrder = 2;
scene.add(water);

export function disposeWaterSurface() {
  scene.remove(water);
  water.geometry.dispose();
  waterMaterial.dispose();
}
