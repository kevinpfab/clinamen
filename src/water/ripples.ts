import * as THREE from "three";
import {
  maxDragWorldSpeed,
  maxRipples,
  velocityWorldScale,
  waterWaveSpeed,
} from "../config";
import type { SharedWaterUniforms } from "./uniforms";
import type { WaterSimulation } from "./simulation";
import type { BowlBody } from "../bowls/types";
import type { DragState } from "../input/types";
import type { Ripple } from "./types";

// Ripples are the visible, expanding surface disturbances from collisions and
// bowl drags. This owns the ripple pool, feeds the simulation impulses, and
// publishes ripple state into the shared water uniforms each frame.
export type RippleField = {
  addCollisionRipple: (
    x: number,
    z: number,
    strength: number,
    direction?: THREE.Vector2,
    lifetime?: number,
  ) => void;
  updateDragWaterInteraction: (
    state: DragState,
    previous: THREE.Vector2,
    current: THREE.Vector2,
    time: number,
  ) => void;
  emitDragReleaseRipple: (state: DragState, time: number) => void;
  update: (delta: number) => void;
};

type RippleFieldDeps = {
  uniforms: SharedWaterUniforms;
  simulation: WaterSimulation;
};

export function createRippleField({ uniforms, simulation }: RippleFieldDeps): RippleField {
  const ripples: Ripple[] = [];

  function addCollisionRipple(
    x: number,
    z: number,
    strength: number,
    direction = new THREE.Vector2(1, 0),
    lifetime = 1.75,
  ) {
    // The floor of the clamp is low so slow, soft collisions produce
    // proportionally faint rings instead of a fixed minimum splash.
    const visualStrength = THREE.MathUtils.clamp(strength, 0.06, 0.88);
    const rippleDirection = direction.lengthSq() > 0.0001
      ? direction.clone().normalize()
      : new THREE.Vector2(1, 0);
    const tangent = new THREE.Vector2(-rippleDirection.y, rippleDirection.x);

    ripples.unshift({
      center: new THREE.Vector2(x, z),
      direction: rippleDirection,
      age: 0,
      lifetime,
      strength: visualStrength,
      shape: 0,
      lastDisturbedAt: -10,
    });
    ripples.splice(maxRipples);
    simulation.queueImpulse(x, z, 0.22 + visualStrength * 0.64, visualStrength * 0.45);
    simulation.queueImpulse(
      x - rippleDirection.x * (0.20 + visualStrength * 0.14),
      z - rippleDirection.y * (0.20 + visualStrength * 0.14),
      0.38 + visualStrength * 0.62,
      -visualStrength * 0.14,
    );
    simulation.queueImpulse(
      x + tangent.x * (0.18 + visualStrength * 0.18),
      z + tangent.y * (0.18 + visualStrength * 0.18),
      0.24 + visualStrength * 0.40,
      visualStrength * 0.07,
    );
    simulation.queueImpulse(
      x - tangent.x * (0.18 + visualStrength * 0.18),
      z - tangent.y * (0.18 + visualStrength * 0.18),
      0.24 + visualStrength * 0.40,
      visualStrength * 0.07,
    );
  }

  function addDirectionalRipple(
    x: number,
    z: number,
    strength: number,
    direction: THREE.Vector2,
    speedRatio: number,
    lifetime = 1.05,
  ) {
    const visualStrength = THREE.MathUtils.clamp(strength, 0.04, 0.34);
    const motion = THREE.MathUtils.clamp(speedRatio, 0, 1);
    const rippleDirection = direction.lengthSq() > 0.0001
      ? direction.clone().normalize()
      : new THREE.Vector2(1, 0);
    const impulseRadius = 0.18 + visualStrength * 0.54 + motion * 0.22;

    ripples.unshift({
      center: new THREE.Vector2(x, z),
      direction: rippleDirection.clone().multiplyScalar(1 + motion),
      age: 0,
      lifetime,
      strength: visualStrength,
      shape: 1,
      lastDisturbedAt: -10,
    });
    ripples.splice(maxRipples);
    simulation.queueDirectionalImpulse(
      x,
      z,
      rippleDirection,
      impulseRadius,
      visualStrength * (0.13 + motion * 0.16),
    );
  }

  function emitDragWakeRipple(
    state: DragState,
    center: THREE.Vector2,
    worldVelocity: THREE.Vector2,
    strength: number,
    lifetime = 1.05,
  ) {
    const speed = worldVelocity.length();
    if (speed < 0.14) {
      return;
    }

    const direction = worldVelocity.clone().divideScalar(speed);
    const speedRatio = THREE.MathUtils.clamp(speed / maxDragWorldSpeed, 0, 1);
    const wakePoint = center.clone().addScaledVector(direction, -state.bowl.radius * 1.04);
    addDirectionalRipple(wakePoint.x, wakePoint.y, strength, direction, speedRatio, lifetime);
  }

  function scatterActiveRipplesFromDraggedBowl(
    bowl: BowlBody,
    center: THREE.Vector2,
    worldVelocity: THREE.Vector2,
    time: number,
  ) {
    const speed = worldVelocity.length();
    if (speed < 0.16 || ripples.length === 0) {
      return;
    }

    const dragDirection = worldVelocity.clone().divideScalar(speed);
    const speedRatio = THREE.MathUtils.clamp(speed / maxDragWorldSpeed, 0, 1);
    const existingRipples = ripples.slice();

    for (const ripple of existingRipples) {
      if (ripple.shape !== 0 || ripple.age < 0.10 || time - ripple.lastDisturbedAt < 0.18) {
        continue;
      }

      const offset = center.clone().sub(ripple.center);
      const distance = offset.length();
      if (distance < 0.001) {
        continue;
      }

      const travel = ripple.age * waterWaveSpeed;
      let nearestFrontDistance = Number.POSITIVE_INFINITY;

      const ringRadius = travel;
      if (ringRadius > 0) {
        nearestFrontDistance = Math.abs(distance - ringRadius);
      }

      const interactionBand = bowl.radius * 0.32 + 0.10;
      const proximity = 1 - THREE.MathUtils.clamp(nearestFrontDistance / interactionBand, 0, 1);
      if (proximity <= 0) {
        continue;
      }

      const rippleDirection = offset.divideScalar(distance);
      const crossing = Math.abs(dragDirection.dot(rippleDirection));
      const opposing = Math.max(0, -dragDirection.dot(rippleDirection));
      const scatterStrength = THREE.MathUtils.clamp(
        ripple.strength * (0.18 + proximity * 0.30)
          + speedRatio * (0.06 + crossing * 0.15 + opposing * 0.10),
        0.06,
        0.30,
      );
      const scatterDirection = rippleDirection.clone()
        .multiplyScalar(0.50)
        .addScaledVector(dragDirection, 0.72 + speedRatio * 0.48);

      if (scatterDirection.lengthSq() < 0.0001) {
        scatterDirection.copy(rippleDirection);
      } else {
        scatterDirection.normalize();
      }

      const waveContact = center.clone().addScaledVector(rippleDirection, -bowl.radius * 0.90);
      const dragContact = center.clone().addScaledVector(dragDirection, bowl.radius * 0.72);
      const contact = waveContact.lerp(dragContact, speedRatio * 0.42);
      addDirectionalRipple(contact.x, contact.y, scatterStrength, scatterDirection, speedRatio, 0.95);

      ripple.strength *= THREE.MathUtils.lerp(0.98, 0.84, proximity * (0.38 + speedRatio * 0.62));
      ripple.direction.lerp(scatterDirection, 0.10 * proximity).normalize();
      ripple.lastDisturbedAt = time;
    }
  }

  function updateDragWaterInteraction(
    state: DragState,
    previous: THREE.Vector2,
    current: THREE.Vector2,
    time: number,
  ) {
    const worldVelocity = state.bowl.velocity.clone().multiplyScalar(velocityWorldScale);
    const speed = worldVelocity.length();
    if (speed < 0.12) {
      return;
    }

    scatterActiveRipplesFromDraggedBowl(state.bowl, current, worldVelocity, time);

    const speedRatio = THREE.MathUtils.clamp(speed / maxDragWorldSpeed, 0, 1);
    const rippleSpacing = Math.max(
      0.16,
      THREE.MathUtils.lerp(state.bowl.radius * 0.62, state.bowl.radius * 0.32, speedRatio),
    );
    const rippleInterval = THREE.MathUtils.lerp(0.18, 0.075, speedRatio);
    const travelSinceRipple = state.lastRipplePoint.distanceTo(current);

    if (travelSinceRipple < rippleSpacing && time - state.lastRippleAt < rippleInterval) {
      return;
    }

    const path = current.clone().sub(state.lastRipplePoint);
    const pathLength = path.length();
    const steps = Math.min(2, Math.max(1, Math.floor(pathLength / rippleSpacing)));
    const motionDirection = current.clone().sub(previous);
    const direction = motionDirection.lengthSq() > 0.0001
      ? motionDirection.normalize()
      : worldVelocity.clone().normalize();
    const baseStrength = THREE.MathUtils.clamp(
      0.052 + speedRatio * 0.18 + Math.min(pathLength, state.bowl.radius) * 0.022,
      0.052,
      0.28,
    );

    for (let step = 1; step <= steps; step += 1) {
      const point = state.lastRipplePoint.clone().lerp(current, step / steps);
      emitDragWakeRipple(state, point, direction.clone().multiplyScalar(speed), baseStrength);
    }

    state.lastRipplePoint.copy(current);
    state.lastRippleAt = time;
  }

  function emitDragReleaseRipple(state: DragState, time: number) {
    const center = new THREE.Vector2(state.bowl.mesh.position.x, state.bowl.mesh.position.z);
    const worldVelocity = state.bowl.velocity.clone().multiplyScalar(velocityWorldScale);
    const speedRatio = THREE.MathUtils.clamp(worldVelocity.length() / maxDragWorldSpeed, 0, 1);

    if (speedRatio <= 0.05) {
      return;
    }

    const strength = THREE.MathUtils.clamp(0.070 + speedRatio * 0.22, 0.070, 0.30);
    emitDragWakeRipple(state, center, worldVelocity, strength, 1.05);
    scatterActiveRipplesFromDraggedBowl(state.bowl, center, worldVelocity, time);
  }

  function updateRipples(delta: number) {
    for (const ripple of ripples) {
      ripple.age += delta;
    }

    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      if (ripples[i].age >= ripples[i].lifetime) {
        ripples.splice(i, 1);
      }
    }

    uniforms.uRippleCount.value = ripples.length;
    for (let i = 0; i < maxRipples; i += 1) {
      const ripple = ripples[i];
      if (ripple) {
        uniforms.uRippleCenters.value[i].set(
          ripple.center.x,
          ripple.center.y,
          ripple.direction.x,
          ripple.direction.y,
        );
        uniforms.uRippleData.value[i].set(ripple.age, ripple.lifetime, ripple.strength, ripple.shape);
      } else {
        uniforms.uRippleCenters.value[i].set(0, 0, 1, 0);
        uniforms.uRippleData.value[i].set(0, 1, 0, 0);
      }
    }
  }

  return {
    addCollisionRipple,
    updateDragWaterInteraction,
    emitDragReleaseRipple,
    update: updateRipples,
  };
}
