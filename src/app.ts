import * as THREE from "three";
import {
  rendererPixelRatioLimit,
  waterSimulationMaxSubsteps,
  waterSimulationStep,
} from "./config";
import { debugSettings, simulationSettings, world } from "./settings";
import type { Stage } from "./core/stage";
import { createSimulationClock } from "./core/simulation-clock";
import { getWaterSurfaceRadius } from "./core/world";
import {
  createCameraControls,
  getPoolFitDistance,
  getResponsiveCameraDefaults,
} from "./core/camera-controls";
import { createWaterUniforms } from "./water/uniforms";
import { createNoiseTexture } from "./water/noise-texture";
import { createWaterSurface } from "./water/surface";
import { createWaterSimulation } from "./water/simulation";
import { createWoodFloor } from "./environment/wood-floor";
import { createBasinFloor } from "./environment/basin-floor";
import { createFlowJets } from "./environment/flow-jets";
import { createFlowShapeControl } from "./ui/flow-shape-control";
import { createFpsCounter } from "./ui/fps-counter";
import { createIntroSequence, type IntroSequence } from "./intro/intro";
import { createLighting } from "./core/lighting";
import { createBowlMaterials } from "./bowls/materials";
import { createRippleField } from "./water/ripples";
import { createBowlField } from "./water/bowl-field";
import { createInteractionField } from "./water/interaction-field";
import { createWaveState } from "./water/wave-state";
import { createBasinAudio, type BasinAudio } from "./audio/basin-audio";
import { EventBus, type BasinEvents } from "./core/events";
import { createFrameDiagnostics, frameDiagnosticsEnabled } from "./core/frame-diagnostics";
import { createBowlSystem } from "./bowls/system";
import { createPointerController, type PointerController } from "./input/pointer-controller";
import type { FlowShape } from "./physics/flow";
import type { WaterLab } from "./dev/water-lab";
import type { BowlBody } from "./bowls/types";

// The composition root. Everything with a lifetime is built here from the
// Stage and torn down in one pass, so a hot reload, a context-loss rebuild, and
// a page unload all follow the same path.
export type BasinApp = {
  dispose: () => void;
};

export type CreateAppOptions = {
  // Skip the title sequence and hand control straight to the pointer. Used by
  // the ?skipIntro dev flag and by a WebGL context-loss rebuild, where sitting
  // the viewer through the reveal a second time would be absurd.
  skipIntro?: boolean;
  waterLab?: boolean;
};

// Anything with a dispose() the app owns. Built in dependency order and torn
// down in reverse — this list is the whole teardown.
type Disposable = { dispose: () => void };

// The sim always integrates fixed 1/60 steps; slower devices catch up with
// extra substeps instead of larger steps, which would change wave speed and
// damping (a 1/30 step used to hit the shader's stepScale clamp and run the
// water in ~17% slow motion relative to the analytic ripples).
const waterSimulationFixedStep = waterSimulationStep;
const maxWaterSimulationSubsteps = waterSimulationMaxSubsteps;

export function createApp(stage: Stage, options: CreateAppOptions = {}): BasinApp {
  const { camera, clock, renderer, scene } = stage;
  const waterLabEnabled = import.meta.env.DEV && options.waterLab === true;
  const disposables: Disposable[] = [];

  function own<T extends Disposable>(system: T): T {
    disposables.push(system);
    return system;
  }

  const bus = new EventBus<BasinEvents>();
  const waterUniforms = createWaterUniforms();
  const noiseTexture = createNoiseTexture();
  waterUniforms.uNoiseMap.value = noiseTexture;
  disposables.push(noiseTexture);

  const cameraControls = createCameraControls(camera, stage.cameraTarget);
  const cameraOrbit = cameraControls.orbit;

  const frameDiagnostics = own(createFrameDiagnostics(renderer));
  const lighting = own(createLighting(scene));
  const bowlMaterials = own(createBowlMaterials(waterUniforms));
  const bowlSystem = own(createBowlSystem({ bus, scene, materials: bowlMaterials, currentEnabled: !waterLabEnabled }));

  const simulation = own(createWaterSimulation({ renderer, uniforms: waterUniforms }));
  const ripples = createRippleField({ simulation });
  const interactionField = own(createInteractionField({ renderer, uniforms: waterUniforms }));
  const bowlField = own(createBowlField({ renderer, uniforms: waterUniforms }));
  const waveState = own(createWaveState({ renderer, uniforms: waterUniforms }));

  const waterSurface = own(createWaterSurface({ scene, uniforms: waterUniforms }));
  const basinFloor = own(createBasinFloor({ scene, uniforms: waterUniforms }));
  const woodFloor = own(createWoodFloor({ scene, renderer }));
  const flowJets = waterLabEnabled ? null : own(createFlowJets({
    scene,
    uniforms: waterUniforms,
    simulation,
    getPoolRadius: getWaterSurfaceRadius,
    getFlowShape: () => simulationSettings.flowShape,
  }));

  let pointerController: PointerController | null = null;
  let intro: IntroSequence | null = null;
  let waterLab: WaterLab | null = null;
  let labFieldsDirty = true;
  let audioEngine: BasinAudio | null = null;
  let audioStartPromise: Promise<void> | null = null;
  let animationFrame = 0;
  let resizeFrame = 0;
  const simulationClock = createSimulationClock(waterSimulationFixedStep, maxWaterSimulationSubsteps);
  let disposed = false;

  function clearWaterState() {
    simulationClock.resetAccumulator();
    simulation.clear();
  }

  function updateWorldSize() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const poolDiameter = aspect < 1 ? 9.8 : aspect < 1.08 ? 12.8 : 14.4;
    world.width = poolDiameter;
    world.height = poolDiameter;

    const cameraDefaults = getResponsiveCameraDefaults(aspect);
    const waterSurfaceRadius = getWaterSurfaceRadius();
    if (waterUniforms.uPoolData.value.z !== waterSurfaceRadius) {
      // Texture coordinates change meaning when the physical pool changes size.
      // Reset both wave representations together instead of stretching old rings.
      pointerController?.cancelInteractions();
      clearWaterState();
    }
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
    cameraControls.apply();

    waterSurface.setRadius(waterSurfaceRadius);
    basinFloor.setRadius(waterSurfaceRadius);
    woodFloor.setPoolRadius(waterSurfaceRadius);
    flowJets?.syncSources();

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
    flowJets?.setPixelRatio(pixelRatio);
    bowlSystem.keepAllInsideBounds();
    waterLab?.refreshCamera();
    labFieldsDirty = true;
  }

  // Mobile browsers fire resize continuously while the URL bar slides in and
  // out, so the work is coalesced onto the next frame instead of running per
  // event.
  function requestWorldSizeUpdate() {
    if (resizeFrame !== 0) {
      return;
    }

    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (disposed) {
        return;
      }
      updateWorldSize();
    });
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
    flowJets?.resetTiming();
    flowJets?.syncSources();
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

  function advanceScene(delta: number, elapsed: number, steps: number, heldBowl: BowlBody | null) {
    waterUniforms.uTime.value = elapsed;
    bowlSystem.update(delta, elapsed, heldBowl);
    frameDiagnostics.recordStep("bowls");
    bowlSystem.resolveCollisions(elapsed, heldBowl);
    frameDiagnostics.recordStep("collisions");
    frameDiagnostics.recordStep("ripples");
    bowlSystem.updateResonance(delta);
    frameDiagnostics.recordStep("resonance");
    intro?.update(delta);
    bowlSystem.updateInstances();
    frameDiagnostics.recordStep("instances");
    bowlField.update(bowlSystem.bowls);
    frameDiagnostics.recordStep("bowlField");
    interactionField.update();
    frameDiagnostics.recordStep("interactionField");
    flowJets?.emitImpulses(elapsed);
    frameDiagnostics.recordStep("flowImpulses");
    for (let step = 0; step < steps; step += 1) {
      simulation.update(waterSimulationFixedStep);
    }
    frameDiagnostics.recordStep("waterSim");
    waveState.update();
    frameDiagnostics.recordStep("waveState");
  }

  function animate(now: DOMHighResTimeStamp) {
    animationFrame = window.requestAnimationFrame(animate);
    frameDiagnostics.beginFrame(now);
    frameDiagnostics.beginGpuFrame();
    const rawDelta = clock.getDelta();
    if (waterLabEnabled) {
      const steps = waterLab?.consumeSteps(rawDelta) ?? 0;
      for (let step = 0; step < steps; step += 1) {
        const heldBowl = waterLab!.beforeStep();
        advanceScene(waterSimulationFixedStep, waterLab!.elapsed, 1, heldBowl);
      }
      if (steps > 0) {
        labFieldsDirty = false;
      } else if (labFieldsDirty) {
        // Repaint a reset pose without advancing damping, collisions or waves.
        bowlSystem.updateInstances();
        bowlField.update(bowlSystem.bowls);
        interactionField.update();
        waveState.update();
        labFieldsDirty = false;
      }
      waterLab?.updateStatus();
    } else {
      const { delta, elapsed, steps } = simulationClock.advance(rawDelta);
      advanceScene(delta, elapsed, steps, pointerController?.getDraggedBowl() ?? null);
    }
    renderer.render(scene, camera);
    frameDiagnostics.endGpuFrame();
    frameDiagnostics.recordStep("render");

    const diagnostics = frameDiagnostics.endFrame(now);
    if (diagnostics) {
      fpsCounter?.update(now, diagnostics);
    }
  }

  function startAnimationLoop() {
    if (animationFrame !== 0 || disposed) {
      return;
    }

    clock.getDelta();
    frameDiagnostics.markLoopStart();
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
      audioEngine ??= createBasinAudio();
      audioEngine.setMasterVolume(debugSettings.masterVolume);
      audioEngine.setToneGain(debugSettings.toneGain);
      await audioEngine.resume();
    })();

    try {
      await audioStartPromise;
    } finally {
      audioStartPromise = null;
    }
  }

  // iOS Safari often refuses to unlock audio from pointerdown (touchstart) and
  // suspends the context when the tab loses focus or the phone locks, so every
  // gesture keeps nudging the context until it is actually running — click
  // fires on touchend, the gesture class WebKit reliably honors.
  function handleAudioUnlockGesture() {
    if (audioEngine?.isRunning) {
      return;
    }

    if (audioEngine) {
      void audioEngine.resume().catch(() => {});
      return;
    }

    void startAudio().catch((error) => {
      console.error("clinamen could not start audio.", error);
    });
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopAnimationLoop();
    } else {
      startAnimationLoop();
      // iOS leaves the context interrupted after a lock/app switch; resuming on
      // return is permitted without a fresh gesture once audio ran before.
      void audioEngine?.resume().catch(() => {});
    }
  }

  const offRipple = bus.on("ripple", ({ x, z, strength }) => {
    ripples.addCollisionRipple(x, z, strength);
  });
  const offTone = bus.on("tone", ({ sizeRatio, strength, sustain }) => {
    audioEngine?.play(sizeRatio, strength, sustain);
  });

  clearWaterState();
  updateWorldSize();
  bowlSystem.rebuild();

  // The title screen owns the first interaction (its strike doubles as the
  // audio-unlock gesture); pointer orbit/drag controls attach once it hands off.
  function attachPointerController() {
    pointerController = own(createPointerController({
      stage,
      cameraControls,
      bowlSystem,
      ripples,
    }));
  }

  if (!options.skipIntro && !waterLabEnabled) {
    intro = createIntroSequence({
      stage,
      cameraControls,
      bus,
      bowlSystem,
      lighting,
      materials: bowlMaterials,
      waterUniforms,
      startAudio,
      onComplete: () => {
        if (disposed) {
          return;
        }
        attachPointerController();
      },
    });
    if (intro) {
      own(intro);
    }
  }
  if (!intro && !waterLabEnabled) {
    attachPointerController();
  }

  if (!waterLabEnabled) own(createFlowShapeControl({
    getFlowShape: () => simulationSettings.flowShape,
    getBowlCount: () => simulationSettings.bowlCount,
    setFlowShape,
    setBowlCount,
  }));

  const fpsCounter = frameDiagnosticsEnabled ? own(createFpsCounter()) : null;

  if (waterLabEnabled) {
    void import("./dev/water-lab").then(({ createWaterLab }) => {
      if (disposed) return;
      waterUniforms.uFlowJetCount.value = 0;
      waterLab = own(createWaterLab({
        bowlSystem,
        ripples,
        bus,
        stage,
        cameraControls,
        resetWater() {
          clearWaterState();
          waterUniforms.uTime.value = 0;
          labFieldsDirty = true;
        },
      }));
    }).catch((error) => console.error("Water lab failed to load.", error));
  }

  if (import.meta.env.DEV && !waterLabEnabled) {
    void import("./ui/debug-panel").then(({ createDebugPanel }) => {
      if (disposed) {
        return;
      }
      own(createDebugPanel({
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
          ripples.addCollisionRipple(0, 0, 0.38);
        },
      }));
    });
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;

    stopAnimationLoop();
    if (resizeFrame !== 0) {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }

    window.removeEventListener("pointerdown", handleAudioUnlockGesture);
    window.removeEventListener("click", handleAudioUnlockGesture);
    window.removeEventListener("resize", requestWorldSizeUpdate);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", dispose);
    offRipple();
    offTone();

    // One idiom, one teardown: everything the app owns exposes dispose(), and
    // reverse construction order means a system is always torn down before
    // whatever it was built from — the intro restores the lighting it borrowed
    // before the lighting itself goes.
    const owned = disposables.splice(0);
    for (let i = owned.length - 1; i >= 0; i -= 1) {
      owned[i].dispose();
    }
    intro = null;
    pointerController = null;

    void audioEngine?.dispose();
    audioEngine = null;
  }

  window.addEventListener("pointerdown", handleAudioUnlockGesture);
  window.addEventListener("click", handleAudioUnlockGesture);
  window.addEventListener("resize", requestWorldSizeUpdate);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  // pagehide, not beforeunload: iOS Safari frequently skips beforeunload when a
  // tab is discarded or restored from the back/forward cache.
  window.addEventListener("pagehide", dispose);

  startAnimationLoop();
  return { dispose };
}
