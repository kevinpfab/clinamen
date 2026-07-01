import * as THREE from "three";
import {
  bowlResonancePulseLifetime,
} from "./materials";
import { bowlImpactAnimationSpeed } from "../config";
import type { BowlBody, BowlResonanceVisual } from "./types";

// Drives the per-bowl resonance pulse. The render layer reads this state into
// per-instance attributes for the rim flare and porcelain warmth.
const bowlImpactYAxis = new THREE.Vector3(0, 1, 0);
function getBowlResonanceEnvelope(age: number, lifetime: number, strength: number) {
  const progress = THREE.MathUtils.clamp(age / Math.max(lifetime, 0.001), 0, 1);
  const attack = THREE.MathUtils.smoothstep(age, 0, 0.045);
  const decay = Math.pow(1 - progress, 1.68);
  return THREE.MathUtils.clamp(strength, 0, 1.25) * attack * decay;
}

function resetBowlResonance(resonance: BowlResonanceVisual) {
  resonance.strength = 0;
  resonance.age = resonance.lifetime;
  resonance.envelope = 0;
}

function getLocalImpactDirection(bowl: BowlBody, direction: THREE.Vector2) {
  const worldDirection = direction.lengthSq() > 0.0001
    ? direction.clone().normalize()
    : new THREE.Vector2(1, 0);
  const localDirection = new THREE.Vector3(worldDirection.x, 0, worldDirection.y);
  localDirection.applyAxisAngle(bowlImpactYAxis, -bowl.mesh.rotation.y);
  return new THREE.Vector2(localDirection.x, localDirection.z).normalize();
}

export function triggerBowlResonance(bowl: BowlBody, strength: number, direction: THREE.Vector2) {
  if (!Number.isFinite(strength)) {
    return;
  }

  const resonance = bowl.resonance;
  const visualStrength = THREE.MathUtils.clamp(0.54 + Math.sqrt(Math.max(0, strength)) * 0.88, 0.62, 1.38);
  const localDirection = getLocalImpactDirection(bowl, direction);
  resonance.age = 0;
  resonance.lifetime = (bowlResonancePulseLifetime + visualStrength * 0.12) / bowlImpactAnimationSpeed;
  resonance.strength = visualStrength;
  resonance.toneRatio = bowl.toneRatio;
  resonance.envelope = 0;
  resonance.impactDirection.copy(localDirection);
}

export function updateBowlResonance(delta: number, bowls: BowlBody[]) {
  for (const bowl of bowls) {
    const resonance = bowl.resonance;
    if (resonance.strength <= 0) {
      continue;
    }

    resonance.age += delta;
    if (resonance.age >= resonance.lifetime) {
      resetBowlResonance(resonance);
      continue;
    }

    const envelope = getBowlResonanceEnvelope(resonance.age, resonance.lifetime, resonance.strength);
    resonance.envelope = envelope;
  }
}
