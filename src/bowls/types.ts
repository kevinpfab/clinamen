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
  momentumStrength: number;
  angularVelocity: number;
  lastImpactAt: number;
  phase: number;
};

export type BowlShellProfile = {
  full: THREE.Vector2[];
  outer: THREE.Vector2[];
  rimY: number;
};
