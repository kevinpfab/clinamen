import type * as THREE from "three";
import { createGpuFrameTimer } from "./gpu-timer";
import type { FpsCounterDiagnostics } from "../ui/fps-counter";

// Per-frame instrumentation: where the frame's milliseconds went on the CPU,
// what the GPU timer query reported, and what the renderer actually drew. Slow
// frames are logged (rate limited), and the FPS counter reads the same payload.
//
// Development only. A production build takes the no-op implementation, so the
// loop pays nothing but a handful of calls that inline away.
export const frameDiagnosticsEnabled = import.meta.env.DEV;

// The animation loop's steps, in the order it runs them. This one list defines
// the timing record's shape, seeds it, and formats it — the key set used to be
// spelled out separately in all three places.
export const FRAME_STEPS = [
  "bowls",
  "collisions",
  "ripples",
  "resonance",
  "instances",
  "bowlField",
  "interactionField",
  "flowImpulses",
  "waterSim",
  "waveState",
  "render",
] as const;

export type FrameStep = typeof FRAME_STEPS[number];
export type FrameStepTimings = Record<FrameStep, number>;

export type FrameDiagnostics = {
  // Call at the top of the frame, before any work.
  beginFrame: (now: DOMHighResTimeStamp) => void;
  // Call after each step, naming the step that just finished.
  recordStep: (step: FrameStep) => void;
  beginGpuFrame: () => void;
  endGpuFrame: () => void;
  // Call after the render. Returns the payload for the FPS counter, or null
  // when diagnostics are off.
  endFrame: (now: DOMHighResTimeStamp) => FpsCounterDiagnostics | null;
  // Call when the loop (re)starts, so a paused tab does not report one
  // enormous frame on resume.
  markLoopStart: () => void;
  dispose: () => void;
};

// A frame slower than any of these is worth a line in the console.
const slowFrameRafThresholdMs = 25;
const slowFrameWorkThresholdMs = 12;
const slowFrameGpuThresholdMs = 12;
const frameDiagnosticsLogIntervalMs = 500;

function roundFrameTiming(value: number) {
  return Math.round(value * 10) / 10;
}

function createEmptyFrameStepTimings(): FrameStepTimings {
  const timings = {} as FrameStepTimings;
  for (const step of FRAME_STEPS) {
    timings[step] = 0;
  }
  return timings;
}

const noopFrameDiagnostics: FrameDiagnostics = {
  beginFrame: () => {},
  recordStep: () => {},
  beginGpuFrame: () => {},
  endGpuFrame: () => {},
  endFrame: () => null,
  markLoopStart: () => {},
  dispose: () => {},
};

export function createFrameDiagnostics(renderer: THREE.WebGLRenderer): FrameDiagnostics {
  if (!frameDiagnosticsEnabled) {
    return noopFrameDiagnostics;
  }

  const gpuTimer = createGpuFrameTimer(renderer);
  const previousAutoReset = renderer.info.autoReset;
  renderer.info.autoReset = false;
  const timings = createEmptyFrameStepTimings();
  let lastAnimationFrameAt = performance.now();
  let lastLoggedAt = 0;
  let suppressedCount = 0;
  let rafDelta = 0;
  let frameWorkStartedAt = 0;
  let stepStartedAt = 0;

  function collectDiagnostics(): FpsCounterDiagnostics {
    const steps: Record<string, number> = {};
    for (const step of FRAME_STEPS) {
      steps[step] = roundFrameTiming(timings[step]);
    }

    return {
      rafDelta,
      approxFps: Math.round(1000 / Math.max(rafDelta, 0.001)),
      work: roundFrameTiming(performance.now() - frameWorkStartedAt),
      gpu: gpuTimer.collect(),
      steps,
      dpr: renderer.getPixelRatio(),
      canvas: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      },
      renderer: {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      },
    };
  }

  function maybeLog(now: DOMHighResTimeStamp, diagnostics: FpsCounterDiagnostics) {
    const gpuWorkMs = diagnostics.gpu?.frameMs ?? 0;
    if (
      diagnostics.rafDelta <= slowFrameRafThresholdMs &&
      diagnostics.work <= slowFrameWorkThresholdMs &&
      gpuWorkMs <= slowFrameGpuThresholdMs
    ) {
      return;
    }

    if (now - lastLoggedAt < frameDiagnosticsLogIntervalMs) {
      suppressedCount += 1;
      return;
    }

    console.log("Basin frame diagnostics", {
      rafDelta: Math.round(diagnostics.rafDelta),
      approxFps: diagnostics.approxFps,
      work: diagnostics.work,
      gpu: diagnostics.gpu,
      steps: diagnostics.steps,
      dpr: diagnostics.dpr,
      canvas: diagnostics.canvas,
      renderer: diagnostics.renderer,
      suppressed: suppressedCount,
    });
    suppressedCount = 0;
    lastLoggedAt = now;
  }

  return {
    beginFrame(now) {
      renderer.info.reset();
      rafDelta = now - lastAnimationFrameAt;
      lastAnimationFrameAt = now;
      frameWorkStartedAt = performance.now();
      stepStartedAt = frameWorkStartedAt;
    },
    recordStep(step) {
      const stepEndedAt = performance.now();
      timings[step] = stepEndedAt - stepStartedAt;
      stepStartedAt = stepEndedAt;
    },
    beginGpuFrame() {
      gpuTimer.beginFrame();
    },
    endGpuFrame() {
      gpuTimer.endFrame();
    },
    endFrame(now) {
      const diagnostics = collectDiagnostics();
      maybeLog(now, diagnostics);
      return diagnostics;
    },
    markLoopStart() {
      lastAnimationFrameAt = performance.now();
    },
    dispose() {
      renderer.info.autoReset = previousAutoReset;
      gpuTimer.dispose();
    },
  };
}
