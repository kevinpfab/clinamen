import * as THREE from "three";
import { maxFlowJets, maxRipples, maxWaterBowls, world } from "../config";
import { camera } from "../core/stage";
import { getWaterSurfaceRadius } from "../core/world";
import type { WaterUniforms } from "./types";

// The shared uniform store for the water surface, basin floor, flow-jet spray,
// reflection material, and GPGPU simulation. There is one instance so every
// pass reads the same ripple, bowl, and flow state.
export const waterUniforms = THREE.UniformsUtils.merge([
  THREE.UniformsLib.lights,
  {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uHeightMap: { value: null },
    uBowlFieldMap: { value: null },
    uInteractionFieldMap: { value: null },
    uCameraPosition: { value: camera.position.clone() },
    uSimWorld: { value: new THREE.Vector4(-world.width / 2, -world.height / 2, world.width, world.height) },
    uPoolData: { value: new THREE.Vector4(0, 0, getWaterSurfaceRadius(), 0.72) },
    uRippleCenters: {
      value: Array.from({ length: maxRipples }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uRippleData: {
      value: Array.from({ length: maxRipples }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uRippleCount: { value: 0 },
    uBowlData: {
      value: Array.from({ length: maxWaterBowls }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uBowlVelocity: {
      value: Array.from({ length: maxWaterBowls }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uBowlCount: { value: 0 },
    uFlowJetData: {
      value: Array.from({ length: maxFlowJets }, () => new THREE.Vector4(0, 0, 1, 0)),
    },
    uFlowJetParams: {
      value: Array.from({ length: maxFlowJets }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uFlowJetCount: { value: 0 },
  },
]) as WaterUniforms & Record<string, THREE.IUniform>;
