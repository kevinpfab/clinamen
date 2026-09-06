import * as THREE from "three";
import type { WaterSimulation } from "./simulation";

// Collision events inject local pressure into the height field. Continuous
// bowl motion is coupled through the bowl field; the GPU owns all propagation.
export type RippleField = {
  addCollisionRipple: (x: number, z: number, strength: number) => void;
};

type RippleFieldDeps = { simulation: WaterSimulation };

export function createRippleField({ simulation }: RippleFieldDeps): RippleField {
  function addCollisionRipple(x: number, z: number, strength: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(strength) || strength <= 0) return;
    const amplitude = THREE.MathUtils.clamp(strength, 0, 0.88);
    // One volume-balanced kernel at the contact, rather than several offset
    // sources and a separate, independently traveling analytic ring.
    simulation.queueImpulse(x, z, 0.18 + amplitude * 0.32, amplitude * 0.45);
  }

  return { addCollisionRipple };
}
