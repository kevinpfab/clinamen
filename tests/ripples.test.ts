import { describe, expect, test } from "bun:test";
import { createRippleField } from "../src/water/ripples";
import type { WaterSimulation } from "../src/water/simulation";
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
});
