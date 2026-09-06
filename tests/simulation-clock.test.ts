import { describe, expect, test } from "bun:test";
import { createSimulationClock } from "../src/core/simulation-clock";

describe("shared simulation time", () => {
  test("analytic time and fixed steps remain within one step across frame rates", () => {
    const step = 1 / 60;
    for (const maxSubsteps of [2, 3]) {
      for (const rate of [20, 30, 60, 90, 120, 144]) {
        const clock = createSimulationClock(step, maxSubsteps);
        let integrated = 0;
        for (let i = 0; i < rate * 3; i += 1) {
          const frame = clock.advance(1 / rate);
          integrated += frame.steps * step;
          expect(frame.steps).toBeLessThanOrEqual(maxSubsteps);
          expect(frame.elapsed - integrated).toBeGreaterThan(-1e-9);
          expect(frame.elapsed - integrated).toBeLessThan(step + 1e-9);
        }
      }
    }
  });

  test("a full-budget frame preserves fractional time accumulated earlier", () => {
    const clock = createSimulationClock(1 / 60, 2);
    expect(clock.advance(1 / 120).steps).toBe(0);
    expect(clock.advance(1 / 30).steps).toBe(2);
    expect(clock.advance(1 / 120).steps).toBe(1);
  });

  test("stalls cannot fast-forward shaders past the physical simulation", () => {
    const clock = createSimulationClock(1 / 60, 2);
    const frame = clock.advance(30);
    expect(frame.delta).toBeCloseTo(1 / 30, 12);
    expect(frame.elapsed).toBe(frame.delta);
    expect(frame.steps).toBe(2);
  });
});
