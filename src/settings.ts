import { DEFAULT_BOWL_COLLISION_SETTINGS } from "./physics/collision";
import { DEFAULT_FLOW_SHAPE, type FlowShape } from "./physics/flow";

// Runtime state: everything in this file changes while the piece runs, driven
// by the debug panel, the flow control, or a resize. It is deliberately split
// from config.ts, which holds only values that are fixed for the session.
//
// These objects are shared by reference rather than copied, so a system that
// holds one sees later edits. Pure functions should take what they need as
// parameters instead of reaching in here — see bowls/tuning.ts, which used to
// read simulationSettings directly and could not be tested because of it.

type DebugSettings = {
  masterVolume: number;
  toneGain: number;
  impactMomentumFloor: number;
  // How much wave energy the basin wall returns (0 = the old fully absorbing
  // rim, 1 = a hard porcelain wall). Some reflection lets ripples cross and
  // interfere near the rim instead of dying there.
  wallReflectance: number;
};

export const debugSettings: DebugSettings = {
  masterVolume: 0.88,
  toneGain: 1.35,
  impactMomentumFloor: 0.002,
  wallReflectance: 0.4,
};

// The bowl size range doubles as the input to bowls/tuning.ts.
export type BowlSizeRange = {
  minRadius: number;
  maxRadius: number;
};

type SimulationSettings = BowlSizeRange & {
  bowlCount: number;
  flowShape: FlowShape;
};

export const simulationSettings: SimulationSettings = {
  bowlCount: 100,
  minRadius: 0.25,
  maxRadius: 0.5,
  flowShape: DEFAULT_FLOW_SHAPE,
};

export const bowlCollisionSettings = { ...DEFAULT_BOWL_COLLISION_SETTINGS };

type WorldBounds = {
  width: number;
  height: number;
};

// World bounds, rewritten on every resize (see core/world).
export const world: WorldBounds = {
  width: 18,
  height: 10,
};
