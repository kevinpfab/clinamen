import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FLOW_SHAPE,
  FLOW_SHAPES,
  getBasinJetSources,
  maxBasinJetSourceCount,
  sampleBasinCurrent,
  type BasinCurrentSample,
  type FlowShape,
} from "../src/physics/flow";

const poolRadius = 6;
const bowlRadius = 0.35;

function sample(
  x: number,
  y: number,
  shape: FlowShape,
  elapsed = 3.25,
  out?: BasinCurrentSample,
) {
  return sampleBasinCurrent({ x, y }, poolRadius, bowlRadius, elapsed, shape, out);
}

// A deterministic scatter of points covering the center, the mid-basin ring,
// the rim band, and the outside.
const gridPoints = (() => {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    for (const ratio of [0, 0.18, 0.45, 0.72, 0.9, 0.99, 1.04, 1.3]) {
      points.push({
        x: Math.cos(angle) * poolRadius * ratio,
        y: Math.sin(angle) * poolRadius * ratio,
      });
    }
  }
  return points;
})();

describe("sampleBasinCurrent", () => {
  test("returns a still sample outside the basin for every shape", () => {
    for (const shape of FLOW_SHAPES) {
      // 1.05 is the outer edge of every shape's inside mask smoothstep.
      const outside = sample(poolRadius * 1.05, 0, shape);

      expect(outside.x).toBe(0);
      expect(outside.y).toBe(0);
      expect(outside.energy).toBe(0);
      expect(outside.centerChannel).toBe(0);
      expect(outside.rimChannel).toBe(0);
    }
  });

  test("moves water inside the basin for every shape", () => {
    for (const shape of FLOW_SHAPES) {
      const inside = sample(poolRadius * 0.5, poolRadius * 0.2, shape);

      expect(Math.hypot(inside.x, inside.y)).toBeGreaterThan(0);
      expect(inside.energy).toBeGreaterThan(0);
    }
  });

  test("the inside mask closes continuously toward the rim", () => {
    for (const shape of FLOW_SHAPES) {
      const rim = Math.hypot(sample(poolRadius * 1.0, 0, shape).x, sample(poolRadius * 1.0, 0, shape).y);
      const beyond = Math.hypot(sample(poolRadius * 1.03, 0, shape).x, sample(poolRadius * 1.03, 0, shape).y);

      expect(beyond).toBeLessThanOrEqual(rim);
      expect(beyond).toBeGreaterThanOrEqual(0);
    }
  });

  test("energy and both channels stay inside [0, 1] across the basin", () => {
    for (const shape of FLOW_SHAPES) {
      for (const elapsed of [0, 1.7, 12.4, 300]) {
        for (const point of gridPoints) {
          const current = sample(point.x, point.y, shape, elapsed);

          expect(Number.isFinite(current.x)).toBe(true);
          expect(Number.isFinite(current.y)).toBe(true);
          expect(current.energy).toBeGreaterThanOrEqual(0);
          expect(current.energy).toBeLessThanOrEqual(1);
          expect(current.centerChannel).toBeGreaterThanOrEqual(0);
          expect(current.centerChannel).toBeLessThanOrEqual(1);
          expect(current.rimChannel).toBeGreaterThanOrEqual(0);
          expect(current.rimChannel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test("is deterministic at a fixed elapsed time", () => {
    for (const shape of FLOW_SHAPES) {
      for (const point of gridPoints) {
        const first = sample(point.x, point.y, shape, 8.125);
        const second = sample(point.x, point.y, shape, 8.125);

        expect(second).toEqual(first);
      }
    }
  });

  test("writes into the caller's sample object instead of allocating", () => {
    const out: BasinCurrentSample = {
      x: 99,
      y: 99,
      energy: 99,
      centerChannel: 99,
      rimChannel: 99,
    };
    const returned = sample(poolRadius * 0.4, poolRadius * 0.4, "centered", 2, out);

    expect(returned).toBe(out);
    expect(out.x).not.toBe(99);
  });

  test("an unknown shape falls back to the default one", () => {
    const fallback = sample(poolRadius * 0.4, poolRadius * 0.3, "not-a-shape" as FlowShape, 2);
    const explicit = sample(poolRadius * 0.4, poolRadius * 0.3, DEFAULT_FLOW_SHAPE, 2);

    expect(fallback).toEqual(explicit);
  });

  test("each shape produces a distinct field", () => {
    const centered = sample(poolRadius * 0.6, poolRadius * 0.25, "centered", 4);
    const ring = sample(poolRadius * 0.6, poolRadius * 0.25, "ring", 4);
    const singularity = sample(poolRadius * 0.6, poolRadius * 0.25, "singularity", 4);

    expect(ring).not.toEqual(centered);
    expect(singularity).not.toEqual(centered);
    expect(singularity).not.toEqual(ring);
  });

  test("a degenerate pool radius does not produce NaN", () => {
    for (const shape of FLOW_SHAPES) {
      const current = sampleBasinCurrent({ x: 0, y: 0 }, 0, bowlRadius, 1, shape);

      expect(Number.isFinite(current.x)).toBe(true);
      expect(Number.isFinite(current.y)).toBe(true);
      expect(Number.isFinite(current.energy)).toBe(true);
    }
  });
});

describe("getBasinJetSources", () => {
  test("every shape fits inside the shader's uFlowJet array", () => {
    for (const shape of FLOW_SHAPES) {
      const sources = getBasinJetSources(poolRadius, shape);

      expect(sources.length).toBeGreaterThan(0);
      expect(sources.length).toBeLessThanOrEqual(maxBasinJetSourceCount);
    }
  });

  test("maxBasinJetSourceCount is the tightest bound over all shapes", () => {
    const largest = Math.max(
      ...FLOW_SHAPES.map((shape) => getBasinJetSources(poolRadius, shape).length),
    );

    expect(largest).toBe(maxBasinJetSourceCount);
  });

  test("sources sit on the basin wall and point somewhere", () => {
    for (const shape of FLOW_SHAPES) {
      for (const source of getBasinJetSources(poolRadius, shape)) {
        expect(Math.hypot(source.x, source.y)).toBeLessThanOrEqual(poolRadius);
        expect(Math.hypot(source.x, source.y)).toBeGreaterThan(poolRadius * 0.9);
        expect(Math.hypot(source.directionX, source.directionY)).toBeCloseTo(1, 10);
        expect(source.radius).toBeGreaterThan(0);
        expect(source.strength).toBeGreaterThan(0);
        expect(source.markerLength).toBeGreaterThan(0);
        expect(source.markerWidth).toBeGreaterThan(0);
      }
    }
  });

  test("source geometry scales with the pool radius", () => {
    const small = getBasinJetSources(3, "ring");
    const large = getBasinJetSources(6, "ring");

    expect(large.length).toBe(small.length);
    for (let i = 0; i < small.length; i += 1) {
      expect(large[i].x).toBeCloseTo(small[i].x * 2, 10);
      expect(large[i].y).toBeCloseTo(small[i].y * 2, 10);
      expect(large[i].radius).toBeCloseTo(small[i].radius * 2, 10);
      expect(large[i].directionX).toBeCloseTo(small[i].directionX, 10);
    }
  });

  test("an unknown shape falls back to the default one", () => {
    expect(getBasinJetSources(poolRadius, "not-a-shape" as FlowShape)).toEqual(
      getBasinJetSources(poolRadius, DEFAULT_FLOW_SHAPE),
    );
  });
});
