import * as THREE from "three";
import { maxFlowJets, maxRipples, waterWaveSpeed, world } from "../config";
import { getWaterSurfaceRadius } from "../core/world";
import type { WaterUniforms } from "./types";

// The shared uniform store for the water surface, basin floor, flow-jet spray,
// reflection material, and GPGPU simulation. There is one instance so every
// pass reads the same ripple, bowl, and flow state.
export const waterUniforms = THREE.UniformsUtils.merge([
  {
    uTime: { value: 0 },
    uHeightMap: { value: null },
    uBowlFieldMap: { value: null },
    uInteractionFieldMap: { value: null },
    uWaveStateMap: { value: null },
    uWaveDetailMap: { value: null },
    uWaveDerivedMap: { value: null },
    uNoiseMap: { value: null },
    uSimWorld: { value: new THREE.Vector4(-world.width / 2, -world.height / 2, world.width, world.height) },
    uPoolData: { value: new THREE.Vector4(0, 0, getWaterSurfaceRadius(), 0.72) },
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
]) as WaterUniforms & Record<string, THREE.IUniform>;
