import * as THREE from "three";

// The porcelain surface: the numbers that decide how a bowl catches light,
// with no dependency on the water uniforms. Split out of materials.ts so
// tools/asset-generator can build the same surface for the favicon and the OG
// card by importing it, instead of mirroring the values and drifting from them.
// materials.ts adds everything that belongs to the piece proper — the emissive
// channel the resonance pulse drives, and the reflection shader.
export const porcelainBaseColor = new THREE.Color(0xf4efe3);
export const porcelainBaseRoughness = 0.54;
export const porcelainBaseClearcoat = 0.42;

export const porcelainSurface: THREE.MeshPhysicalMaterialParameters = {
  color: porcelainBaseColor,
  roughness: porcelainBaseRoughness,
  metalness: 0,
  clearcoat: porcelainBaseClearcoat,
  clearcoatRoughness: 0.28,
  reflectivity: 0.48,
  ior: 1.48,
  // Bowls are open vessels: the inner wall is the back face of the same shell.
  side: THREE.DoubleSide,
};
