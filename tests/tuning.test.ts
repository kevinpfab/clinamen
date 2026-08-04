import { describe, expect, test } from "bun:test";
import {
  getBowlCenterLimit,
  getBowlHeight,
  getBowlPlaneY,
  getBowlRadius,
  getToneRatio,
} from "../src/bowls/tuning";
import { bowlHeightScale, waterPlaneY } from "../src/config";

const sizeRange = { minRadius: 0.25, maxRadius: 0.5 };

describe("getBowlRadius", () => {
  test("returns the midpoint of the range for a single bowl", () => {
    expect(getBowlRadius(0, 1, sizeRange)).toBeCloseTo(0.375, 12);
    expect(getBowlRadius(0, 0, sizeRange)).toBeCloseTo(0.375, 12);
  });

  test("keeps every bowl inside the requested range", () => {
    for (let i = 0; i < 200; i += 1) {
      const radius = getBowlRadius(i, 200, sizeRange);
      expect(radius).toBeGreaterThanOrEqual(sizeRange.minRadius);
      expect(radius).toBeLessThanOrEqual(sizeRange.maxRadius);
    }
  });

  test("spreads bowls across the range rather than clustering", () => {
    const count = 100;
    const radii = Array.from({ length: count }, (_, i) => getBowlRadius(i, count, sizeRange));
    const span = sizeRange.maxRadius - sizeRange.minRadius;
    // Every quarter of the range is represented; a monotone or clustered
    // sequence would leave at least one quarter empty for a prefix this short.
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const low = sizeRange.minRadius + span * (quarter / 4);
      const high = sizeRange.minRadius + span * ((quarter + 1) / 4);
      expect(radii.some((radius) => radius >= low && radius <= high)).toBe(true);
    }
  });

  test("reads the range it is given, not a global", () => {
    const wide = { minRadius: 1, maxRadius: 3 };
    for (let i = 0; i < 50; i += 1) {
      const radius = getBowlRadius(i, 50, wide);
      expect(radius).toBeGreaterThanOrEqual(1);
      expect(radius).toBeLessThanOrEqual(3);
    }
  });
});

describe("getToneRatio", () => {
  test("maps the smallest bowl to 1 and the largest to 0", () => {
    expect(getToneRatio(sizeRange.minRadius, sizeRange)).toBeCloseTo(1, 12);
    expect(getToneRatio(sizeRange.maxRadius, sizeRange)).toBeCloseTo(0, 12);
    expect(getToneRatio(0.375, sizeRange)).toBeCloseTo(0.5, 12);
  });

  test("clamps radii from outside the range", () => {
    expect(getToneRatio(0.05, sizeRange)).toBe(1);
    expect(getToneRatio(9, sizeRange)).toBe(0);
  });

  test("survives a degenerate range without dividing by zero", () => {
    const ratio = getToneRatio(0.4, { minRadius: 0.4, maxRadius: 0.4 });
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBe(1);
  });
});

describe("getBowlCenterLimit", () => {
  test("leaves room for the bowl's own radius inside the pool", () => {
    expect(getBowlCenterLimit(0.5, 8)).toBeCloseTo(7.5, 12);
  });

  test("never returns a limit at or below zero for an oversized bowl", () => {
    expect(getBowlCenterLimit(12, 8)).toBe(0.2);
    expect(getBowlCenterLimit(8, 8)).toBe(0.2);
  });
});

describe("bowl height", () => {
  test("scales the height with the radius", () => {
    expect(getBowlHeight(0.5)).toBeCloseTo(0.5 * bowlHeightScale, 12);
  });

  test("sinks the resting plane by a fraction of the shell bottom", () => {
    expect(getBowlPlaneY(0.5)).toBeLessThan(waterPlaneY);
    // Larger bowls sit fractionally deeper.
    expect(getBowlPlaneY(0.5)).toBeLessThan(getBowlPlaneY(0.25));
  });
});
