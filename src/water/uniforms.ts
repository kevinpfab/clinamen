import * as THREE from "three";
import { maxFlowJets, maxRipples, waterWaveSpeed } from "../config";
import type { WaterUniforms } from "./types";

export type SharedWaterUniforms = WaterUniforms & Record<string, THREE.IUniform>;

// The shared uniform store for the water surface, basin floor, flow-jet spray,
// reflection material, and GPGPU simulation. One store is built per app so
// every pass reads the same ripple, bowl, and flow state by object identity —
// a material holds the very uniform object the field writer mutates.
//
// The geometry uniforms start neutral: app.ts runs its sizing pass before the
// first frame and rewrites uSimWorld and uPoolData from the live world bounds.
export function createWaterUniforms(): SharedWaterUniforms {
  return THREE.UniformsUtils.merge([
    {
      uTime: { value: 0 },
      // Global brightness for the unlit custom shaders (water, basin floor,
      // reflections, spray). Tone-mapping exposure only reaches lit materials,
      // so the intro reveal drives both together.
      uSceneDim: { value: 1 },
      uHeightMap: { value: null },
      uBowlFieldMap: { value: null },
      uInteractionFieldMap: { value: null },
      uWaveStateMap: { value: null },
      uWaveDetailMap: { value: null },
      uWaveDerivedMap: { value: null },
      uNoiseMap: { value: null },
      uSimWorld: { value: new THREE.Vector4(-1, -1, 2, 2) },
      uPoolData: { value: new THREE.Vector4(0, 0, 1, 0.72) },
      uWaveSpeed: { value: waterWaveSpeed },
      uRippleCenters: {
        value: Array.from({ length: maxRipples }, () => new THREE.Vector4(0, 0, 0, 0)),
      },
      uRippleData: {
        value: Array.from({ length: maxRipples }, () => new THREE.Vector4(0, 0, 0, 0)),
      },
      uRippleCount: { value: 0 },
      uFlowJetData: {
        value: Array.from({ length: maxFlowJets }, () => new THREE.Vector4(0, 0, 1, 0)),
      },
      uFlowJetParams: {
        value: Array.from({ length: maxFlowJets }, () => new THREE.Vector4(0, 0, 0, 0)),
      },
      uFlowJetCount: { value: 0 },
    },
  ]) as SharedWaterUniforms;
}
