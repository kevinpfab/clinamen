import * as THREE from "three";
import {
  flowJetAerationParticlesPerJet,
  maxFlowJetAerationParticles,
  flowJetPulseInterval,
  maxFlowJets,
  simulationSettings,
} from "../config";
import { scene } from "../core/stage";
import { seededUnit } from "../core/math";
import { getWaterSurfaceRadius } from "../core/world";
import { getBasinJetSources } from "../physics/flow";
import { waterUniforms } from "../water/uniforms";
import { queueDirectionalWaterImpulseComponents } from "../water/simulation";

// Flow-jet aeration: a GPU point cloud of bubbles streaming from each basin jet,
// plus the per-frame sync of jet sources into the shared water uniforms.
export function getActiveFlowJetSources() {
  return getBasinJetSources(getWaterSurfaceRadius(), simulationSettings.flowShape);
}

function createFlowJetAerationGeometry() {
  const positions = new Float32Array(maxFlowJetAerationParticles * 3);
  const jetIndices = new Float32Array(maxFlowJetAerationParticles);
  const cycleOffsets = new Float32Array(maxFlowJetAerationParticles);
  const laneOffsets = new Float32Array(maxFlowJetAerationParticles);
  const depthOffsets = new Float32Array(maxFlowJetAerationParticles);
  const sizeSeeds = new Float32Array(maxFlowJetAerationParticles);
  const speedSeeds = new Float32Array(maxFlowJetAerationParticles);
  const opacitySeeds = new Float32Array(maxFlowJetAerationParticles);

  for (let jetIndex = 0; jetIndex < maxFlowJets; jetIndex += 1) {
    for (let particleIndex = 0; particleIndex < flowJetAerationParticlesPerJet; particleIndex += 1) {
      const index = jetIndex * flowJetAerationParticlesPerJet + particleIndex;
      const seed = jetIndex * 97.13 + particleIndex * 17.71 + 4.2;
      const lane = seededUnit(seed + 1.0) * 2 - 1;
      positions[index * 3] = 0;
      positions[index * 3 + 1] = 0;
      positions[index * 3 + 2] = 0;
      jetIndices[index] = jetIndex;
      cycleOffsets[index] = (particleIndex / flowJetAerationParticlesPerJet + seededUnit(seed + 2.0) * 0.18) % 1;
      laneOffsets[index] = lane * (0.32 + seededUnit(seed + 3.0) * 0.68);
      depthOffsets[index] = seededUnit(seed + 4.0);
      sizeSeeds[index] = seededUnit(seed + 5.0);
      speedSeeds[index] = seededUnit(seed + 6.0);
      opacitySeeds[index] = seededUnit(seed + 7.0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aJetIndex", new THREE.BufferAttribute(jetIndices, 1));
  geometry.setAttribute("aCycleOffset", new THREE.BufferAttribute(cycleOffsets, 1));
  geometry.setAttribute("aLaneOffset", new THREE.BufferAttribute(laneOffsets, 1));
  geometry.setAttribute("aDepthOffset", new THREE.BufferAttribute(depthOffsets, 1));
  geometry.setAttribute("aSizeSeed", new THREE.BufferAttribute(sizeSeeds, 1));
  geometry.setAttribute("aSpeedSeed", new THREE.BufferAttribute(speedSeeds, 1));
  geometry.setAttribute("aOpacitySeed", new THREE.BufferAttribute(opacitySeeds, 1));
  return geometry;
}

export const flowJetAerationGeometry = createFlowJetAerationGeometry();
export const flowJetAerationUniforms = {
  uTime: waterUniforms.uTime,
  uFlowJetData: waterUniforms.uFlowJetData,
  uFlowJetParams: waterUniforms.uFlowJetParams,
  uFlowJetCount: waterUniforms.uFlowJetCount,
  uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
};
export const flowJetAerationMaterial = new THREE.ShaderMaterial({
  uniforms: flowJetAerationUniforms,
  vertexShader: `
    precision highp float;

    attribute float aJetIndex;
    attribute float aCycleOffset;
    attribute float aLaneOffset;
    attribute float aDepthOffset;
    attribute float aSizeSeed;
    attribute float aSpeedSeed;
    attribute float aOpacitySeed;

    uniform float uTime;
    uniform vec4 uFlowJetData[${maxFlowJets}];
    uniform vec4 uFlowJetParams[${maxFlowJets}];
    uniform int uFlowJetCount;
    uniform float uPixelRatio;

    varying float vAlpha;
    varying float vEdgeLight;
    varying float vHighlight;

    const float AERATION_TAU = 6.28318530718;

    void main() {
      vec4 jet = vec4(0.0, 0.0, 1.0, 0.0);
      vec4 params = vec4(0.0);
      float isActive = 0.0;

      for (int i = 0; i < ${maxFlowJets}; i++) {
        float isSelected = 1.0 - step(0.5, abs(aJetIndex - float(i)));
        jet = mix(jet, uFlowJetData[i], isSelected);
        params = mix(params, uFlowJetParams[i], isSelected);
        isActive += isSelected * (1.0 - step(float(uFlowJetCount), float(i)));
      }

      vec2 source = jet.xy;
      vec2 direction = length(jet.zw) > 0.001 ? normalize(jet.zw) : vec2(1.0, 0.0);
      vec2 tangent = vec2(-direction.y, direction.x);
      float radius = max(params.x, 0.001);
      float strength = params.y;
      float phase = params.w;
      float speed = mix(0.115, 0.245, aSpeedSeed) * mix(0.86, 1.18, clamp(strength * 38.0, 0.0, 1.0));
      float progress = fract(aCycleOffset + uTime * speed + phase * 0.023);
      float ease = progress * progress * (3.0 - 2.0 * progress);
      float along = radius * mix(0.02, 7.90, ease);
      float spread = radius * (0.16 + ease * 1.18);
      float swirl = sin((ease * 4.8 + aOpacitySeed * 2.4 + phase * 0.31) * AERATION_TAU + uTime * 0.92);
      float lateral = aLaneOffset * spread + swirl * radius * (0.08 + ease * 0.18);
      float depth = -radius * mix(0.18, 0.48, ease) - radius * aDepthOffset * 0.16;
      float lift = sin((aCycleOffset + phase * 0.07) * AERATION_TAU + uTime * 1.35) * radius * 0.018;
      vec3 worldPosition = vec3(source + direction * along + tangent * lateral, depth + lift);

      float birthFade = smoothstep(0.00, 0.10, progress);
      float tailFade = 1.0 - smoothstep(0.70, 1.00, progress);
      float streamFade = birthFade * tailFade;
      float strengthFade = clamp(strength * 34.0, 0.0, 1.0);
      vAlpha = clamp(isActive, 0.0, 1.0)
        * streamFade
        * strengthFade
        * mix(0.34, 0.74, aOpacitySeed);
      vEdgeLight = mix(0.30, 0.82, aSizeSeed) * (1.0 - ease * 0.28);
      vHighlight = mix(0.28, 0.92, aOpacitySeed);

      vec4 viewPosition = modelViewMatrix * vec4(worldPosition.x, worldPosition.z, worldPosition.y, 1.0);
      float sizePulse = 0.84 + sin((progress * 3.4 + aSizeSeed + phase * 0.13) * AERATION_TAU) * 0.14;
      float pointSize = mix(4.2, 10.6, aSizeSeed) * sizePulse * (1.0 + ease * 0.38);
      gl_PointSize = clamp(pointSize * (17.0 / max(-viewPosition.z, 0.001)) * uPixelRatio, 2.0, 13.0);
      gl_Position = projectionMatrix * viewPosition;
    }
  `,
  fragmentShader: `
    precision highp float;

    varying float vAlpha;
    varying float vEdgeLight;
    varying float vHighlight;

    void main() {
      vec2 uv = gl_PointCoord * 2.0 - 1.0;
      float distanceFromCenter = length(uv);
      if (distanceFromCenter > 1.0 || vAlpha <= 0.001) {
        discard;
      }

      vec2 highlightOffset = uv - vec2(-0.28, 0.34);
      float softBody = 1.0 - smoothstep(0.20, 0.98, distanceFromCenter);
      float rim = smoothstep(0.96, 0.42, distanceFromCenter) * smoothstep(0.46, 0.86, distanceFromCenter);
      float highlight = exp(-dot(highlightOffset, highlightOffset) * 10.5) * vHighlight;
      float alpha = (softBody * 0.26 + rim * vEdgeLight * 0.62 + highlight * 0.82) * vAlpha;
      vec3 aerationBlue = vec3(0.56, 0.94, 0.98);
      vec3 pearlyWhite = vec3(0.96, 1.0, 0.98);
      vec3 color = mix(aerationBlue, pearlyWhite, clamp(rim * 0.44 + highlight * 0.82, 0.0, 1.0));
      gl_FragColor = vec4(color, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
export const flowJetAeration = new THREE.Points(flowJetAerationGeometry, flowJetAerationMaterial);
flowJetAeration.frustumCulled = false;
flowJetAeration.renderOrder = 1;
scene.add(flowJetAeration);

export function updateFlowJetState() {
  const sources = getActiveFlowJetSources();
  waterUniforms.uFlowJetCount.value = sources.length;
  flowJetAeration.visible = sources.length > 0;

  for (let i = 0; i < maxFlowJets; i += 1) {
    const source = sources[i];
    if (!source) {
      waterUniforms.uFlowJetData.value[i].set(0, 0, 1, 0);
      waterUniforms.uFlowJetParams.value[i].set(0, 0, 0, 0);
      continue;
    }

    waterUniforms.uFlowJetData.value[i].set(source.x, source.y, source.directionX, source.directionY);
    waterUniforms.uFlowJetParams.value[i].set(source.radius, source.strength, source.markerWidth, source.phase);
  }
}


// Flow-jet timing: pulse the jets into the simulation at a fixed cadence.
let lastFlowJetPulseAt = -10;

export function resetFlowJetTiming() {
  lastFlowJetPulseAt = -10;
}
export function emitFlowJetImpulses(elapsed: number) {
  if (elapsed - lastFlowJetPulseAt < flowJetPulseInterval) {
    return;
  }

  const sources = getActiveFlowJetSources();
  for (const source of sources) {
    const pulse = 0.88 + Math.sin(elapsed * 1.86 + source.phase) * 0.18;
    queueDirectionalWaterImpulseComponents(
      source.x,
      source.y,
      source.directionX,
      source.directionY,
      source.radius,
      source.strength * pulse,
    );
  }
  lastFlowJetPulseAt = elapsed;
}

export function disposeFlowJets() {
  scene.remove(flowJetAeration);
  flowJetAerationGeometry.dispose();
  flowJetAerationMaterial.dispose();
}
