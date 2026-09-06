// One bounded timeline for CPU motion, analytic waves, and fixed GPU steps.
// Slow frames drop wall-clock time consistently across all three systems.
export function createSimulationClock(step: number, maxSubsteps: number) {
  let accumulator = 0;
  const frame = { delta: 0, elapsed: 0, steps: 0 };
  return {
    advance(rawDelta: number) {
      frame.delta = Number.isFinite(rawDelta)
        ? Math.max(0, Math.min(rawDelta, step * maxSubsteps))
        : 0;
      frame.elapsed += frame.delta;
      accumulator += frame.delta;
      // Preserve fractional debt even when a frame consumes the full budget.
      frame.steps = Math.min(maxSubsteps, Math.floor((accumulator + step * 1e-9) / step));
      accumulator = Math.max(0, accumulator - frame.steps * step);
      return frame;
    },
    resetAccumulator() {
      accumulator = 0;
    },
  };
}
