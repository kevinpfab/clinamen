import { beforeEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createRippleField, type RippleField } from "../src/water/ripples";
import { createWaterUniforms, type SharedWaterUniforms } from "../src/water/uniforms";
import type { WaterSimulation } from "../src/water/simulation";
import { maxRipples } from "../src/config";

// The ripple field feeds the simulation but does not need one to be tested: it
// only ever calls the queueing half of the interface.
function createSimulationStub(): WaterSimulation {
  return {
    queueImpulse: () => {},
    queueDirectionalImpulse: () => {},
    queueDirectionalImpulseComponents: () => {},
    clear: () => {},
    update: () => {},
    dispose: () => {},
  };
}

let uniforms: SharedWaterUniforms;
let ripples: RippleField;

beforeEach(() => {
  uniforms = createWaterUniforms();
  ripples = createRippleField({ uniforms, simulation: createSimulationStub() });
  // The pool starts empty; publish once so the uniform slots are seeded.
  ripples.update(0);
});

describe("ripple pool", () => {
  test("publishes an empty pool as zeroed uniform slots", () => {
    expect(uniforms.uRippleCount.value).toBe(0);
    for (let i = 0; i < maxRipples; i += 1) {
      expect(uniforms.uRippleCenters.value[i].toArray()).toEqual([0, 0, 1, 0]);
      expect(uniforms.uRippleData.value[i].toArray()).toEqual([0, 1, 0, 0]);
    }
  });

  test("evicts the oldest ripples once the pool is full", () => {
    const overflow = maxRipples + 6;
    for (let i = 0; i < overflow; i += 1) {
      ripples.addCollisionRipple(i, 0, 0.4);
    }
    ripples.update(0);

    expect(uniforms.uRippleCount.value).toBe(maxRipples);

    // Newest first, and only the newest maxRipples survive.
    const centers = uniforms.uRippleCenters.value
      .slice(0, maxRipples)
      .map((center: THREE.Vector4) => center.x);
    const expected = Array.from({ length: maxRipples }, (_, i) => overflow - 1 - i);
    expect(centers).toEqual(expected);
  });

  test("ages ripples and retires them at their lifetime", () => {
    ripples.addCollisionRipple(0, 0, 0.4, new THREE.Vector2(1, 0), 1);
    ripples.update(0.25);

    expect(uniforms.uRippleCount.value).toBe(1);
    expect(uniforms.uRippleData.value[0].x).toBeCloseTo(0.25, 10);
    expect(uniforms.uRippleData.value[0].y).toBe(1);

    ripples.update(0.75);
    expect(uniforms.uRippleCount.value).toBe(0);
    expect(uniforms.uRippleData.value[0].toArray()).toEqual([0, 1, 0, 0]);
  });

  test("clamps collision strength into the visible ring range", () => {
    ripples.addCollisionRipple(0, 0, 12);
    ripples.addCollisionRipple(0, 0, 0);
    ripples.update(0);

    expect(uniforms.uRippleData.value[0].z).toBeCloseTo(0.06, 10);
    expect(uniforms.uRippleData.value[1].z).toBeCloseTo(0.88, 10);
  });

  test("normalizes the ripple direction and falls back for a zero vector", () => {
    ripples.addCollisionRipple(0, 0, 0.4, new THREE.Vector2(3, 4));
    ripples.addCollisionRipple(0, 0, 0.4, new THREE.Vector2(0, 0));
    ripples.update(0);

    expect(uniforms.uRippleCenters.value[0].z).toBe(1);
    expect(uniforms.uRippleCenters.value[0].w).toBe(0);
    expect(uniforms.uRippleCenters.value[1].z).toBeCloseTo(0.6, 10);
    expect(uniforms.uRippleCenters.value[1].w).toBeCloseTo(0.8, 10);
  });

  test("collision ripples are published as radial rings", () => {
    ripples.addCollisionRipple(1.5, -2.5, 0.4);
    ripples.update(0);

    expect(uniforms.uRippleCenters.value[0].x).toBe(1.5);
    expect(uniforms.uRippleCenters.value[0].y).toBe(-2.5);
    expect(uniforms.uRippleData.value[0].w).toBe(0);
  });

  test("each field owns its own pool", () => {
    const otherUniforms = createWaterUniforms();
    const other = createRippleField({
      uniforms: otherUniforms,
      simulation: createSimulationStub(),
    });

    ripples.addCollisionRipple(0, 0, 0.4);
    ripples.update(0);
    other.update(0);

    expect(uniforms.uRippleCount.value).toBe(1);
    expect(otherUniforms.uRippleCount.value).toBe(0);
  });
});
