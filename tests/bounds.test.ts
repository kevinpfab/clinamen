import { describe, expect, test } from "bun:test";
import { resolveCircularBoundaryContact } from "../src/physics/bounds";

describe("resolveCircularBoundaryContact", () => {
  test("does not emit an impact for tangential correction without outward speed", () => {
    const contact = resolveCircularBoundaryContact({
      x: 1.02,
      z: 0,
      vx: 0,
      vz: 0.2,
      radius: 0.5,
      centerLimit: 1,
      restitution: 0.76,
      impactSpeedFloor: 0.001,
    });

    expect(contact.hit).toBe(true);
    expect(contact.shouldEmitImpact).toBe(false);
    expect(contact.nextVx).toBe(0);
    expect(contact.nextVz).toBe(0.2);
  });

  test("reflects outward velocity and emits impact data for real wall hits", () => {
    const contact = resolveCircularBoundaryContact({
      x: 1.02,
      z: 0,
      vx: 0.2,
      vz: 0,
      radius: 0.5,
      centerLimit: 1,
      restitution: 0.5,
      impactSpeedFloor: 0.001,
    });

    expect(contact.hit).toBe(true);
    expect(contact.shouldEmitImpact).toBe(true);
    expect(contact.nextX).toBe(1);
    expect(contact.nextZ).toBe(0);
    expect(contact.nextVx).toBeCloseTo(-0.1);
    expect(contact.impactMomentum).toBeCloseTo(0.1);
  });
});
