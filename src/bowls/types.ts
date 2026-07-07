import * as THREE from "three";

export type BowlResonanceVisual = {
  age: number;
  lifetime: number;
  strength: number;
  toneRatio: number;
  impactDirection: THREE.Vector2;
  envelope: number;
};

export type BowlBody = {
  id: number;
  instanceIndex: number;
  mesh: THREE.Object3D;
  visual: THREE.Object3D;
  resonance: BowlResonanceVisual;
  radius: number;
  contactRadius: number;
  toneRatio: number;
  velocity: THREE.Vector2;
  // 0 = waiting below the surface, 1 = floating. The intro raises this;
  // drift, collisions, and surface effects only engage at 1.
  emergence: number;
  momentumStrength: number;
  angularVelocity: number;
  lastImpactAt: number;
  phase: number;
  // The intro draws the hero's rim flare with a dedicated high-resolution mesh;
  // while set, the instanced renderer skips this bowl's rim so the two don't
  // double-expose the additive glow.
  rimFlareSuppressed?: boolean;
};

export type BowlShellProfile = {
  full: THREE.Vector2[];
  outer: THREE.Vector2[];
  inner: THREE.Vector2[];
  rimY: number;
};
