import * as THREE from "three";

export type WaterUniforms = {
  uTime: { value: number };
  uHeightMap: { value: THREE.Texture | null };
  uBowlFieldMap: { value: THREE.Texture | null };
  uInteractionFieldMap: { value: THREE.Texture | null };
  uWaveStateMap: { value: THREE.Texture | null };
  uWaveDetailMap: { value: THREE.Texture | null };
  uWaveDerivedMap: { value: THREE.Texture | null };
  uNoiseMap: { value: THREE.Texture | null };
  uSimWorld: { value: THREE.Vector4 };
  uPoolData: { value: THREE.Vector4 };
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
  uWallReflectance: { value: number };
};
