import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createRippleField } from "../src/water/ripples";
import type { WaterSimulation } from "../src/water/simulation";
import type { DragState } from "../src/input/types";
import { createDragVelocity } from "../src/input/drag-velocity";
import { getCollisionRippleStrength } from "../src/physics/collision";

function createFixture() {
  const impulses: Array<{ x: number; z: number; radius: number; strength: number }> = [];
  const simulation: WaterSimulation = {
    queueImpulse: (x, z, radius, strength) => impulses.push({ x, z, radius, strength }),
    queueDirectionalImpulse: () => { throw new Error("Historical multi-source waves must not be emitted"); },
    queueDirectionalImpulseComponents: () => {},
    clear: () => {},
    update: () => {},
    dispose: () => {},
  };
  return { impulses, ripples: createRippleField({ simulation }) };
}

function createDragState(speed: number): DragState {
  return {
    bowl: {
      id: 0, instanceIndex: 0, mesh: new THREE.Object3D(), visual: new THREE.Object3D(),
      resonance: { age: 0, lifetime: 1, strength: 0, toneRatio: 0.5, impactDirection: new THREE.Vector2(1, 0), envelope: 0 },
      radius: 0.5, contactRadius: 0.5, toneRatio: 0.5, velocity: new THREE.Vector2(speed, 0),
      waterVelocity: new THREE.Vector2(speed, 0), emergence: 1, momentumStrength: 0, angularVelocity: 0, lastImpactAt: -10, phase: 0,
    },
    pointerId: 1, offset: new THREE.Vector2(), lastRippleAt: 0, lastRipplePoint: new THREE.Vector2(),
    velocity: createDragVelocity(new THREE.Vector2(), 0),
  };
}

describe("height-field ripple sources", () => {
  test("a collision injects exactly one impulse at its physical contact", () => {
    const { ripples, impulses } = createFixture();
    ripples.addCollisionRipple(1.5, -2.5, 0.4);
    expect(impulses).toHaveLength(1);
    expect(impulses[0].x).toBe(1.5);
    expect(impulses[0].z).toBe(-2.5);
    expect(impulses[0].strength).toBeGreaterThan(0);
  });

  test("zero, negative and nonfinite collisions inject no pressure", () => {
    const { ripples, impulses } = createFixture();
    for (const strength of [0, -1, NaN, Infinity]) ripples.addCollisionRipple(0, 0, strength);
    ripples.addCollisionRipple(NaN, 0, 0.4);
    ripples.addCollisionRipple(0, Infinity, 0.4);
    expect(impulses).toHaveLength(0);
  });

  test("soft contact approaches zero instead of receiving a minimum splash", () => {
    const { ripples, impulses } = createFixture();
    ripples.addCollisionRipple(0, 0, 0.001);
    ripples.addCollisionRipple(0, 0, 0.1);
    expect(impulses[0].strength / impulses[1].strength).toBeCloseTo(0.01, 10);
    expect(getCollisionRippleStrength(0, 0, 0)).toBe(0);
    expect(getCollisionRippleStrength(-0.00001, 0.00001, 0)).toBeLessThan(0.002);
  });

  test("extreme collision inputs stay within the simulation's pressure budget", () => {
    const { ripples, impulses } = createFixture();
    ripples.addCollisionRipple(0, 0, 100);
    expect(impulses).toHaveLength(1);
    expect(impulses[0].strength).toBeLessThanOrEqual(0.42);
    expect(impulses[0].radius).toBeLessThan(1);
  });

  test("drag sources stay behind the hull and stop when the held bowl stops", () => {
    const { ripples, impulses } = createFixture();
    const state = createDragState(0.5);
    ripples.updateDragWaterInteraction(state, new THREE.Vector2(), new THREE.Vector2(0.4, 0), 0.2);
    expect(impulses.length).toBeGreaterThan(0);
    expect(impulses.length).toBeLessThanOrEqual(2);
    for (const impulse of impulses) {
      expect(impulse.x).toBeLessThan(0.4);
      expect(impulse.strength).toBeLessThan(0);
    }
    const count = impulses.length;
    state.bowl.velocity.set(0, 0);
    ripples.updateDragWaterInteraction(state, new THREE.Vector2(0.4, 0), new THREE.Vector2(0.4, 0), 1);
    ripples.emitDragReleaseRipple(state);
    expect(impulses).toHaveLength(count);
  });

  test("rapid pointer updates cannot emit an unlimited number of pressure sources", () => {
    const { ripples, impulses } = createFixture();
    const state = createDragState(0.5);
    ripples.updateDragWaterInteraction(state, new THREE.Vector2(), new THREE.Vector2(0.4, 0), 0.2);
    const count = impulses.length;
    ripples.updateDragWaterInteraction(state, new THREE.Vector2(0.4, 0), new THREE.Vector2(0.401, 0), 0.201);
    expect(impulses).toHaveLength(count);
  });
});
