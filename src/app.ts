import * as THREE from "three";
import {
  debugSettings,
  rendererPixelRatioLimit,
  simulationSettings,
  waterSimulationMaxSubsteps,
  waterSimulationStep,
  world,
} from "./config";
import { camera, clock, disposeStage, renderer, scene } from "./core/stage";
import { getWaterSurfaceRadius } from "./core/world";
import {
  applyCameraOrbit,
  cameraOrbit,
  getPoolFitDistance,
  getResponsiveCameraDefaults,
} from "./core/camera-controls";
import { waterUniforms } from "./water/uniforms";
import { disposeWaterSurface, water } from "./water/surface";
import {
  clearWaterSimulation,
  disposeWaterSimulation,
  updateWaterSimulation,
} from "./water/simulation";
import {
  createCircularWoodFloorGeometry,
  disposeWoodFloor,
  woodFloor,
} from "./environment/wood-floor";
import { basinFloor, disposeBasinFloor } from "./environment/basin-floor";
import {
  disposeFlowJets,
  emitFlowJetImpulses,
  flowJetAerationUniforms,
  resetFlowJetTiming,
  updateFlowJetState,
} from "./environment/flow-jets";
import { createFlowShapeControl } from "./ui/flow-shape-control";
import {
  createAudioStartButton,
  createFpsCounter,
  type AudioStartButton,
  type FpsCounter,
  type FpsCounterDiagnostics,
} from "./ui/fps-counter";
import { createLighting } from "./core/lighting";
import { disposeBowlSharedMaterials } from "./bowls/materials";
import { addCollisionRipple, updateRipples } from "./water/ripples";
import { disposeBowlField, updateBowlField } from "./water/bowl-field";
import { disposeInteractionField, updateInteractionField } from "./water/interaction-field";
import { disposeWaveState, updateWaveState } from "./water/wave-state";
import { disposeNoiseTexture } from "./water/noise-texture";
import { BasinAudio } from "./audio/basin-audio";
import { EventBus, type BasinEvents } from "./core/events";
import { createGpuFrameTimer, type GpuTimingSnapshot } from "./core/gpu-timer";
import { BowlSystem } from "./bowls/system";
import { createPointerController, type PointerController } from "./input/pointer-controller";
import type { FlowShape } from "./physics/flow";

const bus = new EventBus<BasinEvents>();
const bowlSystem = new BowlSystem(bus);
const lighting = createLighting();
let pointerController: PointerController | null = null;
let audioEngine: BasinAudio | null = null;
let audioStartPromise: Promise<void> | null = null;
let audioStartButton: AudioStartButton | null = null;
let animationFrame = 0;
let waterSimulationAccumulator = 0;
let disposed = false;
// The sim always integrates fixed 1/60 steps; slower devices catch up with
// extra substeps instead of larger steps, which would change wave speed and
// damping (a 1/30 step used to hit the shader's stepScale clamp and run the
// water in ~17% slow motion relative to the analytic ripples).
const waterSimulationFixedStep = waterSimulationStep;
const maxWaterSimulationSubsteps = waterSimulationMaxSubsteps;

const frameDiagnosticsEnabled = import.meta.env.DEV ||
  new URLSearchParams(window.location.search).has("frameDiagnostics");
const gpuFrameTimer = frameDiagnosticsEnabled ? createGpuFrameTimer(renderer) : null;
let fpsCounter: FpsCounter | null = null;
const slowFrameRafThresholdMs = 25;
const slowFrameWorkThresholdMs = 12;
const slowFrameGpuThresholdMs = 12;
const frameDiagnosticsLogIntervalMs = 500;
let lastAnimationFrameAt = performance.now();
let lastFrameDiagnosticsLogAt = 0;
let suppressedFrameDiagnosticCount = 0;

type Destroyable = {
  destroy: () => void;
};

type DisposeAppOptions = {
  disposeSharedResources?: boolean;
};

type FrameStepTimings = {
  bowls: number;
  collisions: number;
  ripples: number;
  resonance: number;
  instances: number;
  bowlField: number;
  interactionField: number;
  flowImpulses: number;
  waterSim: number;
  waveState: number;
  render: number;
};

function roundFrameTiming(value: number) {
  return Math.round(value * 10) / 10;
}

function createEmptyFrameStepTimings(): FrameStepTimings {
  return {
    bowls: 0,
    collisions: 0,
    ripples: 0,
    resonance: 0,
    instances: 0,
    bowlField: 0,
    interactionField: 0,
    flowImpulses: 0,
    waterSim: 0,
    waveState: 0,
    render: 0,
  };
}

function maybeLogFrameDiagnostics(
  now: DOMHighResTimeStamp,
  diagnostics: FpsCounterDiagnostics,
) {
  const gpuWorkMs = diagnostics.gpu?.frameMs ?? 0;
  if (
    !frameDiagnosticsEnabled ||
    (
      diagnostics.rafDelta <= slowFrameRafThresholdMs &&
      diagnostics.work <= slowFrameWorkThresholdMs &&
      gpuWorkMs <= slowFrameGpuThresholdMs
    )
  ) {
    return;
  }

  if (now - lastFrameDiagnosticsLogAt < frameDiagnosticsLogIntervalMs) {
    suppressedFrameDiagnosticCount += 1;
    return;
  }

  console.log("Basin frame diagnostics", {
    rafDelta: Math.round(diagnostics.rafDelta),
    approxFps: diagnostics.approxFps,
    work: roundFrameTiming(diagnostics.work),
    gpu: diagnostics.gpu,
    steps: diagnostics.steps,
    dpr: diagnostics.dpr,
    canvas: diagnostics.canvas,
    renderer: diagnostics.renderer,
    suppressed: suppressedFrameDiagnosticCount,
  });
  suppressedFrameDiagnosticCount = 0;
  lastFrameDiagnosticsLogAt = now;
}

function createFrameDiagnostics(
  rafDelta: number,
  work: number,
  timings: FrameStepTimings,
  gpu: GpuTimingSnapshot | null,
): FpsCounterDiagnostics {
  return {
    rafDelta,
    approxFps: Math.round(1000 / Math.max(rafDelta, 0.001)),
    work: roundFrameTiming(work),
    gpu,
    steps: {
      bowls: roundFrameTiming(timings.bowls),
      collisions: roundFrameTiming(timings.collisions),
      ripples: roundFrameTiming(timings.ripples),
      resonance: roundFrameTiming(timings.resonance),
      instances: roundFrameTiming(timings.instances),
      bowlField: roundFrameTiming(timings.bowlField),
      interactionField: roundFrameTiming(timings.interactionField),
      flowImpulses: roundFrameTiming(timings.flowImpulses),
      waterSim: roundFrameTiming(timings.waterSim),
      waveState: roundFrameTiming(timings.waveState),
      render: roundFrameTiming(timings.render),
    },
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

function clearWaterState() {
  waterSimulationAccumulator = 0;
  clearWaterSimulation();
}

function updateWorldSize() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const poolDiameter = aspect < 1 ? 9.8 : aspect < 1.08 ? 12.8 : 14.4;
  world.width = poolDiameter;
  world.height = poolDiameter;

  const cameraDefaults = getResponsiveCameraDefaults(aspect);
  const waterSurfaceRadius = getWaterSurfaceRadius();
  camera.aspect = aspect;
  camera.fov = cameraDefaults.fov;
  cameraOrbit.minDistance = Math.max(waterSurfaceRadius * 0.88, 6.8);
  cameraOrbit.maxDistance = Math.max(cameraDefaults.distance * 2.2, waterSurfaceRadius * 3.4);

  if (!cameraOrbit.hasUserControl) {
    cameraOrbit.azimuth = cameraDefaults.azimuth;
    cameraOrbit.pitch = cameraDefaults.pitch;
    cameraOrbit.distance = cameraDefaults.distance;
    if (aspect < 1) {
      cameraOrbit.distance = Math.max(
        cameraOrbit.distance,
        getPoolFitDistance(waterSurfaceRadius, cameraDefaults.fov, aspect),
      );
    }
  }

  cameraOrbit.pitch = THREE.MathUtils.clamp(
    cameraOrbit.pitch,
    cameraOrbit.minPitch,
    cameraOrbit.maxPitch,
  );
  cameraOrbit.distance = THREE.MathUtils.clamp(
    cameraOrbit.distance,
    cameraOrbit.minDistance,
    cameraOrbit.maxDistance,
  );
  camera.updateProjectionMatrix();
  applyCameraOrbit();

  water.scale.set(waterSurfaceRadius, waterSurfaceRadius, 1);
  basinFloor.scale.set(waterSurfaceRadius, waterSurfaceRadius, 1);
  updateFlowJetState();

  const floorExtent = waterSurfaceRadius * 2 + 34;
  woodFloor.geometry.dispose();
  woodFloor.geometry = createCircularWoodFloorGeometry(floorExtent, waterSurfaceRadius);

  waterUniforms.uSimWorld.value.set(
    -waterSurfaceRadius,
    -waterSurfaceRadius,
    waterSurfaceRadius * 2,
    waterSurfaceRadius * 2,
  );
  waterUniforms.uPoolData.value.set(
    0,
    0,
    waterSurfaceRadius,
    Math.max(0.46, waterSurfaceRadius * 0.084),
  );
  const pixelRatio = Math.min(window.devicePixelRatio, rendererPixelRatioLimit);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  flowJetAerationUniforms.uPixelRatio.value = pixelRatio;
  bowlSystem.keepAllInsideBounds();
}

function rebuildBowls() {
  pointerController?.cancelInteractions();
  bowlSystem.rebuild();
  clearWaterState();
  updateWorldSize();
}

function setFlowShape(nextShape: FlowShape) {
  if (simulationSettings.flowShape === nextShape) {
    return;
  }

  simulationSettings.flowShape = nextShape;
  resetFlowJetTiming();
  updateFlowJetState();
  clearWaterState();
}

function setBowlCount(nextCount: number) {
  if (simulationSettings.bowlCount === nextCount) {
    return;
  }

  simulationSettings.bowlCount = nextCount;
  rebuildBowls();
}

function setBowlSizeRange(minRadius: number, maxRadius: number) {
  simulationSettings.minRadius = minRadius;
  simulationSettings.maxRadius = maxRadius;
  rebuildBowls();
}

function updateWaterSimulationForFrame(delta: number) {
  waterSimulationAccumulator = Math.min(
    waterSimulationAccumulator + delta,
    waterSimulationFixedStep * maxWaterSimulationSubsteps,
  );

  let substeps = 0;
  while (
    waterSimulationAccumulator >= waterSimulationFixedStep &&
    substeps < maxWaterSimulationSubsteps
  ) {
    updateWaterSimulation(waterSimulationFixedStep);
    waterSimulationAccumulator -= waterSimulationFixedStep;
    substeps += 1;
  }
}

function animate(now: DOMHighResTimeStamp) {
  animationFrame = window.requestAnimationFrame(animate);
  let rafDelta = 0;
  if (frameDiagnosticsEnabled) {
    rafDelta = now - lastAnimationFrameAt;
    lastAnimationFrameAt = now;
  }
  const frameWorkStartedAt = frameDiagnosticsEnabled ? performance.now() : 0;
  let stepStartedAt = frameWorkStartedAt;
  const timings = frameDiagnosticsEnabled ? createEmptyFrameStepTimings() : null;
  const recordStep = timings ? (step: keyof FrameStepTimings) => {
    const stepEndedAt = performance.now();
    timings[step] = stepEndedAt - stepStartedAt;
    stepStartedAt = stepEndedAt;
  } : null;

  const delta = Math.min(clock.getDelta(), 0.04);
  const elapsed = clock.elapsedTime;
  waterUniforms.uTime.value = elapsed;

  bowlSystem.update(delta, elapsed, pointerController?.getDraggedBowl() ?? null);
  recordStep?.("bowls");
  bowlSystem.resolveCollisions(elapsed, pointerController?.getDraggedBowl() ?? null);
  recordStep?.("collisions");
  updateRipples(delta);
  recordStep?.("ripples");
  bowlSystem.updateResonance(delta);
  recordStep?.("resonance");
  bowlSystem.updateInstances();
  recordStep?.("instances");
  gpuFrameTimer?.beginFrame();
  updateBowlField(bowlSystem.bowls);
  recordStep?.("bowlField");
  updateInteractionField();
  recordStep?.("interactionField");
  emitFlowJetImpulses(elapsed);
  recordStep?.("flowImpulses");
  updateWaterSimulationForFrame(delta);
  recordStep?.("waterSim");
  updateWaveState();
  recordStep?.("waveState");
  renderer.render(scene, camera);
  gpuFrameTimer?.endFrame();
  recordStep?.("render");

  if (!timings) {
    return;
  }

  const gpuTiming = gpuFrameTimer?.collect() ?? null;
  const diagnostics = createFrameDiagnostics(
    rafDelta,
    performance.now() - frameWorkStartedAt,
    timings,
    gpuTiming,
  );
  maybeLogFrameDiagnostics(now, diagnostics);
  fpsCounter?.update(now, diagnostics);
}

function startAnimationLoop() {
  if (animationFrame !== 0) {
    return;
  }

  clock.getDelta();
  lastAnimationFrameAt = performance.now();
  animationFrame = window.requestAnimationFrame(animate);
}

function stopAnimationLoop() {
  if (animationFrame === 0) {
    return;
  }

  window.cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

async function startAudio() {
  if (audioStartPromise) {
    return audioStartPromise;
  }

  audioStartPromise = (async () => {
    audioEngine ??= new BasinAudio();
    audioEngine.setMasterVolume(debugSettings.masterVolume);
    audioEngine.setToneGain(debugSettings.toneGain);
    await audioEngine.resume();
    audioStartButton?.setStarted();
  })();

  try {
    await audioStartPromise;
  } finally {
    audioStartPromise = null;
  }
}

function handleGlobalAudioPointerDown() {
  if (audioEngine) {
    return;
  }

  void startAudio().catch((error) => {
    console.error("Microtonal Basin could not start audio.", error);
  });
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopAnimationLoop();
  } else {
    startAnimationLoop();
  }
}

export function disposeApp(options: DisposeAppOptions = {}) {
  if (disposed) {
    return;
  }
  disposed = true;
  const disposeSharedResources = options.disposeSharedResources ?? true;

  stopAnimationLoop();
  pointerController?.dispose();
  pointerController = null;
  window.removeEventListener("pointerdown", handleGlobalAudioPointerDown);
  window.removeEventListener("resize", updateWorldSize);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  offRipple();
  offTone();
  audioStartButton?.destroy();
  audioStartButton = null;
  fpsCounter?.destroy();
  fpsCounter = null;
  flowShapeControl?.destroy();
  debugPanel?.destroy();
  gpuFrameTimer?.dispose();
  bowlSystem.dispose();
  lighting.dispose();
  if (disposeSharedResources) {
    disposeBowlSharedMaterials();
    disposeInteractionField();
    disposeBowlField();
    disposeWaveState();
    disposeWaterSimulation();
    disposeNoiseTexture();
    disposeFlowJets();
    disposeWaterSurface();
    disposeWoodFloor();
    disposeBasinFloor();
    disposeStage();
  }
  void audioEngine?.close();
  audioEngine = null;
}

function handleBeforeUnload() {
  disposeApp();
}

const offRipple = bus.on("ripple", ({ x, z, strength, direction }) => {
  addCollisionRipple(x, z, strength, direction);
});
const offTone = bus.on("tone", ({ sizeRatio, strength }) => {
  audioEngine?.play(sizeRatio, strength);
});

clearWaterState();
updateWorldSize();
bowlSystem.rebuild();
pointerController = createPointerController({
  bowlSystem,
});
audioStartButton = createAudioStartButton({ onStartAudio: startAudio });
const flowShapeControl = createFlowShapeControl({
  getFlowShape: () => simulationSettings.flowShape,
  getBowlCount: () => simulationSettings.bowlCount,
  setFlowShape,
  setBowlCount,
});
if (frameDiagnosticsEnabled) {
  fpsCounter = createFpsCounter();
}

let debugPanel: Destroyable | undefined;
if (import.meta.env.DEV) {
  void import("./ui/debug-panel").then(({ createDebugPanel }) => {
    if (disposed) {
      return;
    }
    debugPanel = createDebugPanel({
      getMasterVolume: () => debugSettings.masterVolume,
      setMasterVolume: (value) => {
        debugSettings.masterVolume = value;
        audioEngine?.setMasterVolume(value);
      },
      getToneGain: () => debugSettings.toneGain,
      setToneGain: (value) => {
        debugSettings.toneGain = value;
        audioEngine?.setToneGain(value);
      },
      getImpactMomentumFloor: () => debugSettings.impactMomentumFloor,
      setImpactMomentumFloor: (value) => {
        debugSettings.impactMomentumFloor = value;
      },
      getWallReflectance: () => debugSettings.wallReflectance,
      setWallReflectance: (value) => {
        debugSettings.wallReflectance = value;
      },
      getBowlCount: () => simulationSettings.bowlCount,
      setBowlCount,
      getMinRadius: () => simulationSettings.minRadius,
      getMaxRadius: () => simulationSettings.maxRadius,
      setBowlSizeRange,
      playTestTone: async () => {
        await startAudio();
        audioEngine?.play(0.58, 0.72);
        addCollisionRipple(0, 0, 0.38);
      },
    });
  });
}

window.addEventListener("pointerdown", handleGlobalAudioPointerDown, { once: true });
window.addEventListener("resize", updateWorldSize);
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("beforeunload", handleBeforeUnload);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeApp({ disposeSharedResources: false });
  });
}

startAnimationLoop();
