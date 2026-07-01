import * as THREE from "three";

// Stable hash → [0, 1). Used to seed flow-jet aeration particles so the spray
// pattern is identical across reloads.
export function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453123;
  return value - Math.floor(value);
}

// Stable hash → [0, 1) used for bowl placement.
export function pseudoRandom(seed: number) {
  return THREE.MathUtils.euclideanModulo(Math.sin(seed) * 43758.5453123, 1);
}
