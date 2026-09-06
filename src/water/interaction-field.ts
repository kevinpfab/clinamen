import * as THREE from "three";
import { maxFlowJets, waterInteractionFieldSize } from "../config";
import {
  basinConstantsChunk,
  basinMaskChunk,
  gaussianChunk,
  valueNoiseChunk,
} from "./shader-chunks";
import type { SharedWaterUniforms } from "./uniforms";

// Analytic jet plumes and nozzle texture, evaluated once per frame. Collision
// and bowl-drag waves live exclusively in the GPGPU simulation.
export type InteractionField = {
  update: () => void;
  dispose: () => void;
};

type InteractionFieldDeps = {
  renderer: THREE.WebGLRenderer;
  uniforms: SharedWaterUniforms;
};

const interactionFieldOptions = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

const interactionFieldVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const interactionFieldFragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform vec4 uSimWorld;
  uniform vec4 uPoolData;
  uniform sampler2D uNoiseMap;
  uniform vec4 uFlowJetData[${maxFlowJets}];
  uniform vec4 uFlowJetParams[${maxFlowJets}];
  uniform int uFlowJetCount;

  varying vec2 vUv;

  ${basinConstantsChunk}
  ${valueNoiseChunk}
  ${gaussianChunk}
  ${basinMaskChunk}

  float flowChannelField(vec2 p) {
    float energy = 0.0;

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
      float d = length(offset);
      float nozzle = expFalloff(d, radius * 1.36);
      float downstream = smoothstep(-radius * 0.35, radius * 0.80, along);
      float plume = downstream
        * expFalloff(across, radius * 2.75)
        * exp(-max(along, 0.0) / (radius * 8.8));
      float advected = along / radius * 0.42 - uTime * 0.62 + phase;
      float axialNoise = valueNoise(vec2(advected, across / radius * 1.75 + phase));
      float lane = sin((across / radius * 0.52 + axialNoise * 0.34 + phase * 0.17) * BASIN_TAU) * 0.5 + 0.5;
      float centerThread = expFalloff(across, radius * 0.74);
      float sideThread = expFalloff(abs(across) - radius * 1.36, radius * 0.56);
      float downstreamTexture = 0.48 + centerThread * 0.22 + sideThread * 0.16 + lane * 0.12 + axialNoise * 0.10;
      float pulse = sin((advected * 0.34 + phase) * BASIN_TAU) * 0.5 + 0.5;
      energy += (nozzle * 0.56 + plume * (downstreamTexture + pulse * 0.035)) * strength * 19.0;
    }

    return clamp(energy, 0.0, 1.35);
  }

  vec3 flowRippleField(vec2 p) {
    float waveHeight = 0.0;
    float waveSlope = 0.0;
    float waveEnergy = 0.0;

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
      float nozzlePulse = sin(uTime * 2.35 + phase * 1.37) * 0.5 + 0.5;
      float centerPhase = activeAlong / radius * 3.10 - uTime * 1.86 + phase * 1.71;
      float shoulderPhase = activeAlong / radius * 5.20 - uTime * 2.42 + abs(across) / radius * 0.78 + phase;
      float crossRipple = sin((across / radius) * 2.20 + activeAlong / radius * 0.48 - uTime * 1.18 + phase);
      float force = strength * 30.0;
      float centerWave = sin(centerPhase) * centerEnvelope;
      float shoulderWave = sin(shoulderPhase) * shoulderEnvelope;
      float turbulentThread = crossRipple * centerEnvelope * (0.20 + nozzlePulse * 0.12);

      waveHeight += (
        centerWave * 0.052
        + shoulderWave * 0.026
        + turbulentThread * 0.017
        + nozzle * (0.021 + nozzlePulse * 0.016)
      ) * force;
      waveSlope += (
        abs(centerWave) * 0.44
        + abs(shoulderWave) * 0.34
        + centerEnvelope * 0.120
        + shoulderEnvelope * 0.150
        + nozzle * 0.34
      ) * force;
      waveEnergy += (
        centerEnvelope * 0.32
        + shoulderEnvelope * 0.26
        + nozzle * (0.48 + nozzlePulse * 0.18)
      ) * force;
    }

    return vec3(waveHeight, waveSlope, waveEnergy);
  }

  void main() {
    vec2 p = uSimWorld.xy + vUv * uSimWorld.zw;
    float mask = basinMask(p);
    if (mask <= 0.001) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float flowChannel = flowChannelField(p);
    vec3 flowWake = flowRippleField(p);

    gl_FragColor = vec4(
      flowWake.x * 0.84 + flowChannel * 0.0035,
      flowWake.y * 0.78 + flowChannel * 0.040,
      flowWake.z * 0.86 + flowChannel * 0.072,
      flowChannel
    ) * mask;
  }
`;

export function createInteractionField({
  renderer,
  uniforms,
}: InteractionFieldDeps): InteractionField {
  const target = new THREE.WebGLRenderTarget(
    waterInteractionFieldSize,
    waterInteractionFieldSize,
    interactionFieldOptions,
  );
  target.texture.name = "Basin water interaction field";
  // The target never ping-pongs, so the composite passes can bind it once.
  uniforms.uInteractionFieldMap.value = target.texture;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uSimWorld: uniforms.uSimWorld,
      uPoolData: uniforms.uPoolData,
      uNoiseMap: uniforms.uNoiseMap,
      uFlowJetData: uniforms.uFlowJetData,
      uFlowJetParams: uniforms.uFlowJetParams,
      uFlowJetCount: uniforms.uFlowJetCount,
    },
    vertexShader: interactionFieldVertexShader,
    fragmentShader: interactionFieldFragmentShader,
  });

  const fieldScene = new THREE.Scene();
  const fieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fieldQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  fieldScene.add(fieldQuad);

  return {
    update() {
      renderer.setRenderTarget(target);
      renderer.render(fieldScene, fieldCamera);
      renderer.setRenderTarget(null);
    },

    dispose() {
      target.dispose();
      material.dispose();
      fieldQuad.geometry.dispose();
    },
  };
}
