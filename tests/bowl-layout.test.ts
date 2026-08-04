import { describe, expect, test } from "bun:test";
import { scatterBowlPosition } from "../src/bowls/layout";
import {
  separateBodies,
  separationTolerance,
  type SeparationBody,
} from "../src/physics/separation";
import { getBowlCenterLimit, getBowlRadius } from "../src/bowls/tuning";
import { getBowlContactRadius } from "../src/physics/collision";

// The startup layout is scatter-then-relax: bowls/layout.ts places them in O(1)
// each and physics/separation.ts resolves whatever overlaps. These tests pin
// that the two halves together actually produce a collision-free pool, which is
// the property the old 180-attempt rejection sampler was paying for.

const poolRadius = 7.9;
const sizeRange = { minRadius: 0.25, maxRadius: 0.5 };
const padding = 0.06;

function buildLayout(count: number): SeparationBody[] {
  return Array.from({ length: count }, (_, index) => {
    const radius = getBowlRadius(index, count, sizeRange);
    const centerLimit = getBowlCenterLimit(radius, poolRadius);
    const position = scatterBowlPosition(index, count, centerLimit);
    return {
      x: position.x,
      z: position.z,
      contactRadius: getBowlContactRadius(radius),
      centerLimit,
    };
  });
}

function findOverlaps(bodies: SeparationBody[]) {
  const overlaps: Array<[number, number]> = [];
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const gap = bodies[i].contactRadius + bodies[j].contactRadius + padding;
      const distance = Math.hypot(bodies[j].x - bodies[i].x, bodies[j].z - bodies[i].z);
      if (distance < gap - separationTolerance) {
        overlaps.push([i, j]);
      }
    }
  }
  return overlaps;
}

describe("bowl scatter", () => {
  test("keeps every bowl inside its own center limit", () => {
    for (const body of buildLayout(100)) {
      expect(Math.hypot(body.x, body.z)).toBeLessThanOrEqual(body.centerLimit + 1e-9);
    }
  });

  test("fills the disc instead of crowding the center", () => {
    const bodies = buildLayout(100);
    const outer = bodies.filter(
      (body) => Math.hypot(body.x, body.z) > body.centerLimit * 0.7,
    );
    // Uniform area coverage puts ~51% of bowls beyond 0.7r. Anything close to
    // zero would mean the scatter had collapsed toward the middle.
    expect(outer.length).toBeGreaterThan(bodies.length * 0.35);
  });

  test("is deterministic across runs", () => {
    expect(buildLayout(40)).toEqual(buildLayout(40));
  });
});

describe("startup layout", () => {
  test("relaxes the default pool to a collision-free arrangement", () => {
    const bodies = buildLayout(100);
    const iterations = separateBodies(bodies, { padding, maxIterations: 120 });

    expect(iterations).toBeLessThan(120);
    expect(findOverlaps(bodies)).toEqual([]);
  });

  test("holds a pinned bowl exactly in place", () => {
    const bodies = buildLayout(100);
    // The intro centers its hero bowl and pins it there.
    bodies[0].x = 0;
    bodies[0].z = 0;
    bodies[0].pinned = true;

    separateBodies(bodies, { padding, maxIterations: 120 });

    expect(bodies[0].x).toBe(0);
    expect(bodies[0].z).toBe(0);
    expect(findOverlaps(bodies)).toEqual([]);
  });

  test("keeps relaxed bowls inside the basin", () => {
    const bodies = buildLayout(100);
    separateBodies(bodies, { padding, maxIterations: 120 });

    for (const body of bodies) {
      expect(Math.hypot(body.x, body.z)).toBeLessThanOrEqual(body.centerLimit + 1e-9);
    }
  });
});

describe("separateBodies", () => {
  test("reports zero iterations for an already-separated layout", () => {
    const bodies: SeparationBody[] = [
      { x: -3, z: 0, contactRadius: 0.5, centerLimit: 9 },
      { x: 3, z: 0, contactRadius: 0.5, centerLimit: 9 },
    ];

    expect(separateBodies(bodies, { padding, maxIterations: 32 })).toBe(0);
    expect(bodies[0].x).toBe(-3);
    expect(bodies[1].x).toBe(3);
  });

  test("pushes an overlapping pair apart symmetrically", () => {
    const bodies: SeparationBody[] = [
      { x: -0.1, z: 0, contactRadius: 0.5, centerLimit: 9 },
      { x: 0.1, z: 0, contactRadius: 0.5, centerLimit: 9 },
    ];

    separateBodies(bodies, { padding, maxIterations: 32 });

    expect(Math.hypot(bodies[1].x - bodies[0].x, bodies[1].z - bodies[0].z))
      .toBeGreaterThanOrEqual(1 + padding - separationTolerance);
    expect(bodies[0].x).toBeCloseTo(-bodies[1].x, 12);
  });

  test("separates exactly coincident bodies", () => {
    const bodies: SeparationBody[] = [
      { x: 1, z: 1, contactRadius: 0.4, centerLimit: 9 },
      { x: 1, z: 1, contactRadius: 0.4, centerLimit: 9 },
    ];

    separateBodies(bodies, { padding, maxIterations: 64 });

    expect(Math.hypot(bodies[1].x - bodies[0].x, bodies[1].z - bodies[0].z))
      .toBeGreaterThanOrEqual(0.8 + padding - separationTolerance);
  });

  test("leaves two pinned bodies alone even when they overlap", () => {
    const bodies: SeparationBody[] = [
      { x: 0, z: 0, contactRadius: 0.5, centerLimit: 9, pinned: true },
      { x: 0.1, z: 0, contactRadius: 0.5, centerLimit: 9, pinned: true },
    ];

    expect(separateBodies(bodies, { padding, maxIterations: 8 })).toBe(0);
    expect(bodies[1].x).toBe(0.1);
  });
});
