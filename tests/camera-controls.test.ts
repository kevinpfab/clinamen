import { describe, expect, test } from "bun:test";
import { getPoolFitDistance, getResponsiveCameraDefaults } from "../src/core/camera-controls";
import { isMobilePerformanceTarget } from "../src/config";

const poolRadius = 7.2;

describe("getPoolFitDistance", () => {
  test("backs the camera further off in portrait than in landscape", () => {
    const portrait = getPoolFitDistance(poolRadius, 54, 0.5);
    const landscape = getPoolFitDistance(poolRadius, 54, 1.78);

    expect(portrait).toBeGreaterThan(landscape);
  });

  test("is limited by the horizontal field of view below aspect 1", () => {
    const aspect = 0.62;
    const fov = 54;
    const halfVertical = (fov * Math.PI) / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);

    expect(getPoolFitDistance(poolRadius, fov, aspect)).toBeCloseTo(
      (poolRadius * 1.1) / Math.sin(halfHorizontal),
      10,
    );
  });

  test("is limited by the vertical field of view at or above aspect 1", () => {
    const fov = 48;
    const halfVertical = (fov * Math.PI) / 360;
    const expected = (poolRadius * 1.1) / Math.sin(halfVertical);

    expect(getPoolFitDistance(poolRadius, fov, 1)).toBeCloseTo(expected, 10);
    expect(getPoolFitDistance(poolRadius, fov, 2.4)).toBeCloseTo(expected, 10);
  });

  test("scales linearly with the pool radius and shrinks as the fov widens", () => {
    expect(getPoolFitDistance(2 * poolRadius, 54, 0.5)).toBeCloseTo(
      2 * getPoolFitDistance(poolRadius, 54, 0.5),
      10,
    );
    expect(getPoolFitDistance(poolRadius, 70, 0.5)).toBeLessThan(
      getPoolFitDistance(poolRadius, 40, 0.5),
    );
  });

  test("keeps a 10% margin around the pool", () => {
    // Straight down the frustum: half the fov is 45 degrees, so the fit
    // distance is exactly the padded radius over sin(45).
    expect(getPoolFitDistance(1, 90, 1)).toBeCloseTo(1.1 / Math.sin(Math.PI / 4), 10);
  });
});

describe("getResponsiveCameraDefaults", () => {
  test("portrait uses the top-down overview framing", () => {
    const portrait = getResponsiveCameraDefaults(0.55);

    expect(portrait.fov).toBe(54);
    expect(portrait.pitch).toBe(1.38);
    expect(portrait.distance).toBe(20.2);
  });

  test("landscape on a fine-pointer device uses the lower three-quarter framing", () => {
    const landscape = getResponsiveCameraDefaults(1.78);

    if (isMobilePerformanceTarget) {
      expect(landscape.fov).toBe(54);
      return;
    }

    expect(landscape.fov).toBe(48);
    expect(landscape.pitch).toBeCloseTo(Math.atan2(9.8, 14.4), 10);
    expect(landscape.distance).toBeCloseTo(Math.hypot(9.8, 14.4), 10);
  });
});
