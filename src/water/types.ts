import * as THREE from "three";

export type Ripple = {
  center: THREE.Vector2;
  direction: THREE.Vector2;
  age: number;
  lifetime: number;
  strength: number;
  shape: 0 | 1;
  lastDisturbedAt: number;
};

export type WaterUniforms = {
  uTime: { value: number };
  uHeightMap: { value: THREE.Texture | null };
  uBowlFieldMap: { value: THREE.Texture | null };
  uInteractionFieldMap: { value: THREE.Texture | null };
  uSimWorld: { value: THREE.Vector4 };
  uPoolData: { value: THREE.Vector4 };
  uWaveSpeed: { value: number };
  uRippleCenters: { value: THREE.Vector4[] };
  uRippleData: { value: THREE.Vector4[] };
  uRippleCount: { value: number };
  uBowlData: { value: THREE.Vector4[] };
  uBowlVelocity: { value: THREE.Vector4[] };
  uBowlCount: { value: number };
  uFlowJetData: { value: THREE.Vector4[] };
  uFlowJetParams: { value: THREE.Vector4[] };
  uFlowJetCount: { value: number };
};

export type WaterSimulationUniforms = {
  uState: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uSimWorld: { value: THREE.Vector4 };
  uPoolData: { value: THREE.Vector4 };
  uImpulseData: { value: THREE.Vector4[] };
  uImpulseCount: { value: number };
  uDelta: { value: number };
  uWaveKick: { value: number };
};
