import { maxBasinJetSourceCount } from "./physics/flow";

// Fixed configuration: every value here is decided once, at module load, and
// never changes for the life of the session. Anything the piece rewrites while
// running lives in settings.ts instead.

const hasWindow = typeof window !== "undefined";
const coarsePointer = hasWindow &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

// --- Device detection and renderer setup ---
export const isMobilePerformanceTarget = coarsePointer;
export const rendererPixelRatioLimit = isMobilePerformanceTarget ? 1.5 : 2;
export const rendererAntialias = true;
export const enableSceneShadows = false;

// --- Bowl geometry ---
export const goldenRatio = (1 + Math.sqrt(5)) / 2;
export const bowlWallStraightness = 0.75;
export const bowlHeightScale = 1 / goldenRatio;
export const bowlLatheSegments = 36;
// The intro's hero bowl gets a far finer rim for its close-up impulse flare, so
// the traveling wave reads as a smooth circle tracing the rounded lip rather
// than the faceted 36-gon the instanced field rims share.
export const heroBowlRimSegments = 200;
export const bowlShellBottomHeightScale = 0.010;
export const bowlImpactColorIntensity = isMobilePerformanceTarget ? 1.85 : 1.0;
export const bowlImpactRimInnerRadius = isMobilePerformanceTarget ? 0.52 : 0.86;
export const bowlImpactInwardReachScale = isMobilePerformanceTarget ? 4.25 : 1.0;
export const bowlImpactAnimationSpeed = isMobilePerformanceTarget ? 2.35 : 1.0;

// --- Simulation capacities (also interpolated into shader sources) ---
export const maxRipples = 14;
export const maxWaterBowls = 100;
export const maxWaterImpulses = 96;
export const maxFlowJets = maxBasinJetSourceCount;
export const waterSimulationSize = isMobilePerformanceTarget ? 256 : 384;
export const waterSimulationStep = 1 / 60;
export const waterSimulationMaxSubsteps = isMobilePerformanceTarget ? 2 : 3;
export const bowlFieldTextureSize = isMobilePerformanceTarget ? 256 : 384;
export const waterInteractionFieldSize = isMobilePerformanceTarget ? 256 : 384;

// The propagation speed of simulated and analytic ripples, in world units per
// second. The GPGPU sim derives its integration constant from this so ring
// speed no longer depends on texture resolution or pool size, and the
// analytic ripple layers use the same value so both ring systems co-travel.
export const waterWaveSpeed = 1.15;

// --- Intro emergence ---
// How far below its resting plane a bowl sits while it waits to surface
// during the intro reveal. Deep enough that even the tallest rim hides
// beneath the opaque basin floor (-0.58) until its rise begins.
export const bowlEmergenceDepth = 1.35;

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
