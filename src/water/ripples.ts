import * as THREE from "three";
import { maxDragWorldSpeed, velocityWorldScale } from "../config";
import type { WaterSimulation } from "./simulation";
import type { DragState } from "../input/types";

// Events inject local pressure into the height field. The GPU alone owns wave
// propagation and decay, including trails left after a bowl stops moving.
export type RippleField = {
  addCollisionRipple: (x: number, z: number, strength: number) => void;
  updateDragWaterInteraction: (
    state: DragState,
    previous: THREE.Vector2,
    current: THREE.Vector2,
    time: number,
  ) => void;
  emitDragReleaseRipple: (state: DragState) => void;
};

type RippleFieldDeps = { simulation: WaterSimulation };

export function createRippleField({ simulation }: RippleFieldDeps): RippleField {
  function addCollisionRipple(x: number, z: number, strength: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(strength) || strength <= 0) return;
    const amplitude = THREE.MathUtils.clamp(strength, 0, 0.88);
    // One volume-balanced kernel at the contact, rather than several offset
    // sources and a separate, independently traveling analytic ring.
    simulation.queueImpulse(x, z, 0.22 + amplitude * 0.64, amplitude * 0.45);
  }

  function emitDragWake(state: DragState, center: THREE.Vector2, direction: THREE.Vector2, speed: number) {
    const motion = THREE.MathUtils.clamp(speed / maxDragWorldSpeed, 0, 1);
    // A small stern depression leaves a persistent trail in the same solver.
    // Its amplitude approaches zero with speed; there is no minimum splash.
    simulation.queueImpulse(
      center.x - direction.x * state.bowl.radius * 1.04,
      center.y - direction.y * state.bowl.radius * 1.04,
      0.18 + motion * 0.22,
      -motion * motion * 0.070,
    );
  }

  function updateDragWaterInteraction(state: DragState, previous: THREE.Vector2, current: THREE.Vector2, time: number) {
    const worldVelocity = state.bowl.velocity.clone().multiplyScalar(velocityWorldScale);
    const speed = worldVelocity.length();
    if (!Number.isFinite(speed) || speed < 0.12) return;
    const motion = THREE.MathUtils.clamp(speed / maxDragWorldSpeed, 0, 1);
    const spacing = Math.max(0.16, THREE.MathUtils.lerp(state.bowl.radius * 0.62, state.bowl.radius * 0.32, motion));
    const interval = THREE.MathUtils.lerp(0.18, 0.075, motion);
    const distance = state.lastRipplePoint.distanceTo(current);
    if (distance < spacing && time - state.lastRippleAt < interval) return;
    const direction = current.clone().sub(previous);
    if (direction.lengthSq() > 0.0001) direction.normalize();
    else direction.copy(worldVelocity).divideScalar(speed);
    const steps = Math.min(2, Math.max(1, Math.floor(distance / spacing)));
    for (let step = 1; step <= steps; step += 1) {
      const point = state.lastRipplePoint.clone().lerp(current, step / steps);
      emitDragWake(state, point, direction, speed);
    }
    state.lastRipplePoint.copy(current);
    state.lastRippleAt = time;
  }

  function emitDragReleaseRipple(state: DragState) {
    const worldVelocity = state.bowl.velocity.clone().multiplyScalar(velocityWorldScale);
    const speed = worldVelocity.length();
    if (!Number.isFinite(speed) || speed < 0.14) return;
    const center = new THREE.Vector2(state.bowl.mesh.position.x, state.bowl.mesh.position.z);
    emitDragWake(state, center, worldVelocity.divideScalar(speed), speed);
  }

  return { addCollisionRipple, updateDragWaterInteraction, emitDragReleaseRipple };
}
