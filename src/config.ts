import { DEFAULT_BOWL_COLLISION_SETTINGS } from "./physics/collision";
import { DEFAULT_FLOW_SHAPE, maxBasinJetSourceCount, type FlowShape } from "./physics/flow";

const hasWindow = typeof window !== "undefined";
const coarsePointer = hasWindow &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

export const isMobilePerformanceTarget = coarsePointer;
export const rendererPixelRatioLimit = isMobilePerformanceTarget ? 1.5 : 2;
export const rendererAntialias = true;
export const enableSceneShadows = false;

// Runtime-tunable settings. These objects are mutated in place (by the debug
// panel and flow controls) and read across systems, so they are shared by
// reference rather than copied.
export const debugSettings = {
  masterVolume: 0.88,
  toneGain: 1.35,
  impactMomentumFloor: 0.002,
};

export const simulationSettings = {
  bowlCount: 100,
  minRadius: 0.25,
  maxRadius: 0.5,
  flowShape: DEFAULT_FLOW_SHAPE as FlowShape,
};

export const bowlCollisionSettings = {
  ...DEFAULT_BOWL_COLLISION_SETTINGS,
  restitution: 0.52,
};

// World bounds are mutated on resize (see core/world).
export const world = {
  width: 18,
  height: 10,
};

// --- Bowl geometry ---
export const goldenRatio = (1 + Math.sqrt(5)) / 2;
export const bowlWallStraightness = 0.75;
export const bowlHeightScale = 1 / goldenRatio;
export const bowlLatheSegments = 36;
export const bowlShellBottomHeightScale = 0.010;
export const bowlImpactColorIntensity = isMobilePerformanceTarget ? 1.85 : 1.0;
export const bowlImpactRimInnerRadius = isMobilePerformanceTarget ? 0.52 : 0.86;
export const bowlImpactInwardReachScale = isMobilePerformanceTarget ? 4.25 : 1.0;
export const bowlImpactAnimationSpeed = isMobilePerformanceTarget ? 2.35 : 1.0;

// --- Simulation capacities (also interpolated into shader sources) ---
export const maxRipples = 14;
export const maxWaterBowls = 100;
export const maxWaterImpulses = 48;
export const maxFlowJets = maxBasinJetSourceCount;
export const waterSimulationSize = isMobilePerformanceTarget ? 256 : 384;
export const waterSimulationStepInterval = isMobilePerformanceTarget ? 1 / 30 : 0;
export const bowlFieldTextureSize = isMobilePerformanceTarget ? 256 : 384;
export const waterInteractionFieldSize = isMobilePerformanceTarget ? 256 : 384;

// --- Motion / physics tuning ---
export const velocityWorldScale = 4.2;
export const maxDragWorldSpeed = 3.4;
export const waterPlaneY = 0;
export const bowlImpactCooldown = 0.18;

// --- Flow jets ---
export const flowJetPulseInterval = 0.105;
export const flowJetAerationParticlesPerJet = 64;
export const maxFlowJetAerationParticles = maxFlowJets * flowJetAerationParticlesPerJet;

// --- Pool framing ---
export const waterSurfacePadding = 1.4;
export const circularPoolSegments = 192;

// --- Camera control sensitivity ---
export const cameraOrbitDragSensitivity = 0.0052;
export const cameraOrbitPitchSensitivity = 0.0044;
export const cameraZoomSensitivity = 0.0011;
export const dragVelocitySampleWindow = 0.085;
export const dragFastVelocityBlend = 0.82;
export const dragSlowVelocityBlend = 0.28;
export const dragStoppedVelocityRetention = 0.018;
