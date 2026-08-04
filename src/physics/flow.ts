export type FlowPoint = {
  x: number;
  y: number;
};

export type BasinCurrentSample = {
  x: number;
  y: number;
  energy: number;
  centerChannel: number;
  rimChannel: number;
};

export type BasinJetSource = {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  radius: number;
  strength: number;
  markerLength: number;
  markerWidth: number;
  phase: number;
};

export const FLOW_SHAPES = ["centered", "ring", "singularity"] as const;
export type FlowShape = typeof FLOW_SHAPES[number];
export const DEFAULT_FLOW_SHAPE: FlowShape = "centered";
export const FLOW_SHAPE_LABELS: Record<FlowShape, string> = {
  centered: "Two arcs",
  ring: "Ring",
  singularity: "Singularity",
};

const TAU = Math.PI * 2;
const WALL_JET_RADIUS_RATIO = 0.992;
const CENTERED_BOTTOM_OFFSETS = [-0.075, 0, 0.075];
const CENTERED_TOP_OFFSETS = [-0.16, -0.055, 0.055, 0.16];
const RING_JET_ANGLES = [-2.72, -1.98, -1.24, -0.50, 0.24, 0.98, 1.72, 2.46];
const SINGULARITY_JET_ANGLES = [-2.92, -2.14, -1.36, -0.58, 0.20, 0.98, 1.76, 2.54];

export const maxBasinJetSourceCount = Math.max(
  CENTERED_BOTTOM_OFFSETS.length + CENTERED_TOP_OFFSETS.length,
  RING_JET_ANGLES.length,
  SINGULARITY_JET_ANGLES.length,
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const span = edge1 - edge0;
  if (Math.abs(span) < 0.000001) {
    return value < edge0 ? 0 : 1;
  }

  const t = clamp((value - edge0) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

function gaussian(value: number, width: number) {
  const safeWidth = Math.max(width, 0.000001);
  const scaled = value / safeWidth;
  return Math.exp(-(scaled * scaled));
}

function normalizedDirection(x: number, y: number) {
  const length = Math.hypot(x, y);
  if (length <= 0.000001) {
    return { x: 0, y: -1 };
  }

  return { x: x / length, y: y / length };
}

function wallPointForXOffset(offset: number, side: -1 | 1, radius: number) {
  const wallRadius = radius * WALL_JET_RADIUS_RATIO;
  const x = offset * radius;
  const y = side * Math.sqrt(Math.max(wallRadius * wallRadius - x * x, 0));
  return { x, y };
}

function ringJetDirection(radialX: number, radialY: number) {
  const tangentX = -radialY;
  const tangentY = radialX;
  return normalizedDirection(tangentX * 0.92 - radialX * 0.38, tangentY * 0.92 - radialY * 0.38);
}

function setCurrentSample(
  out: BasinCurrentSample,
  x: number,
  y: number,
  energy: number,
  centerChannel: number,
  rimChannel: number,
) {
  out.x = x;
  out.y = y;
  out.energy = energy;
  out.centerChannel = centerChannel;
  out.rimChannel = rimChannel;
  return out;
}

// Every shape opens and closes the same way: normalize the sample point
// against the pool, fade out across the rim, accumulate a velocity, then stir
// in the eddy field and slow the result by the bowl drag. Only the middle —
// the channels and jets that give a shape its character — differs.
//
// The frame is module state reused across calls: sampling runs per bowl per
// frame and this is a hot path. Nothing here yields, so there is one sample in
// flight at a time.
const flowFrame = {
  radius: 0,
  nx: 0,
  ny: 0,
  radialDistance: 0,
  insideMask: 0,
  bowlDrag: 0,
  x: 0,
  y: 0,
};

// The eddy pair is shared; how strongly each axis reads it is not.
const WAKE_EDDY_MIX = {
  primaryX: 0.72,
  secondaryX: 0.28,
  secondaryY: 0.64,
  primaryY: -0.22,
};

type EddyMix = typeof WAKE_EDDY_MIX;

const SINGULARITY_EDDY_MIX: EddyMix = {
  primaryX: 0.66,
  secondaryX: 0.24,
  secondaryY: 0.58,
  primaryY: -0.18,
};

// Returns false when the point is outside the basin, in which case the caller
// has nothing to do but report stillness.
function beginFlowSample(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  maskStart: number,
  maskEnd: number,
) {
  const radius = Math.max(poolRadius, 0.001);
  flowFrame.radius = radius;
  flowFrame.nx = point.x / radius;
  flowFrame.ny = point.y / radius;
  flowFrame.radialDistance = Math.hypot(flowFrame.nx, flowFrame.ny);
  flowFrame.insideMask = 1 - smoothstep(maskStart, maskEnd, flowFrame.radialDistance);
  flowFrame.bowlDrag = clamp(1.12 - bowlRadius * 0.44, 0.76, 1.04);
  flowFrame.x = 0;
  flowFrame.y = 0;
  return flowFrame.insideMask > 0;
}

// Two crossed sine fields keep the current from reading as a static vector
// field; the basin edge and the bowl drag then damp the whole sample.
function endFlowSample(
  elapsed: number,
  eddyStrength: number,
  mix: EddyMix,
  centerChannel: number,
  rimChannel: number,
  out: BasinCurrentSample,
): BasinCurrentSample {
  const { nx, ny, insideMask, bowlDrag } = flowFrame;
  const eddyA = Math.sin((nx * 2.35 - ny * 1.75) * TAU + elapsed * 0.31);
  const eddyB = Math.cos((nx * 1.15 + ny * 2.60) * TAU - elapsed * 0.27);
  const strength = eddyStrength * insideMask;
  const damping = insideMask * bowlDrag;
  const x = (flowFrame.x + (eddyA * mix.primaryX + eddyB * mix.secondaryX) * strength) * damping;
  const y = (flowFrame.y + (eddyB * mix.secondaryY + eddyA * mix.primaryY) * strength) * damping;

  return setCurrentSample(
    out,
    x,
    y,
    clamp(Math.hypot(x, y) / 0.090, 0, 1),
    clamp(centerChannel, 0, 1),
    clamp(rimChannel, 0, 1),
  );
}

// A ring of wall nozzles, each a downstream plume with a slow pulse. The ring
// and singularity shapes differ only in where the nozzles aim and how far the
// plumes carry.
type WallJetField = {
  angles: readonly number[];
  jetDirection: (sourceX: number, sourceY: number) => FlowPoint;
  downstreamStart: number;
  downstreamEnd: number;
  plumeWidth: number;
  plumeReach: number;
  speed: number;
  pulseBase: number;
  pulseRate: number;
  pulseStep: number;
};

function addWallJets(field: WallJetField, elapsed: number, gate: number) {
  const { nx, ny } = flowFrame;

  for (let i = 0; i < field.angles.length; i += 1) {
    const angle = field.angles[i];
    const sourceX = Math.cos(angle) * WALL_JET_RADIUS_RATIO;
    const sourceY = Math.sin(angle) * WALL_JET_RADIUS_RATIO;
    const direction = field.jetDirection(sourceX, sourceY);
    const crossX = -direction.y;
    const crossY = direction.x;
    const offsetX = nx - sourceX;
    const offsetY = ny - sourceY;
    const along = offsetX * direction.x + offsetY * direction.y;
    const across = offsetX * crossX + offsetY * crossY;
    const downstream = smoothstep(field.downstreamStart, field.downstreamEnd, along);
    const plume = downstream
      * gaussian(across, field.plumeWidth)
      * Math.exp(-Math.max(along, 0) / field.plumeReach)
      * flowFrame.insideMask
      * gate;
    const pulse = field.pulseBase + Math.sin(elapsed * field.pulseRate + i * field.pulseStep) * 0.10;

    flowFrame.x += direction.x * plume * field.speed * pulse;
    flowFrame.y += direction.y * plume * field.speed * pulse;
  }
}

const RING_WALL_JETS: WallJetField = {
  angles: RING_JET_ANGLES,
  jetDirection: (sourceX, sourceY) => {
    const radial = normalizedDirection(sourceX, sourceY);
    return ringJetDirection(radial.x, radial.y);
  },
  downstreamStart: -0.018,
  downstreamEnd: 0.090,
  plumeWidth: 0.115,
  plumeReach: 0.58,
  speed: 0.064,
  pulseBase: 0.84,
  pulseRate: 0.46,
  pulseStep: 0.91,
};

const SINGULARITY_WALL_JETS: WallJetField = {
  angles: SINGULARITY_JET_ANGLES,
  jetDirection: (sourceX, sourceY) => normalizedDirection(-sourceX, -sourceY),
  downstreamStart: -0.016,
  downstreamEnd: 0.082,
  plumeWidth: 0.118,
  plumeReach: 0.70,
  speed: 0.060,
  pulseBase: 0.86,
  pulseRate: 0.52,
  pulseStep: 0.83,
};

// Two wall arcs feeding a center channel that runs the length of the basin.
function sampleCenteredCurrent(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  elapsed: number,
  out: BasinCurrentSample,
): BasinCurrentSample {
  if (!beginFlowSample(point, poolRadius, bowlRadius, 0.97, 1.05)) {
    return setCurrentSample(out, 0, 0, 0, 0, 0);
  }

  const { radius, nx, ny, radialDistance } = flowFrame;
  const centerWidth = 0.205 + clamp(bowlRadius / radius, 0, 0.12) * 0.72;
  const centerChannel = gaussian(nx, centerWidth)
    * (1 - smoothstep(0.64, 0.98, radialDistance))
    * (0.70 + 0.30 * smoothstep(-0.80, 0.74, ny));
  const bottomJetProximity = smoothstep(0.76, 0.91, ny);
  const bottomJet = gaussian(ny - 0.91, 0.125) * gaussian(nx, 0.26) * bottomJetProximity;
  const topSplit = gaussian(ny + 0.90, 0.18) * gaussian(nx, 0.46);

  const sideSign = nx < 0 ? -1 : 1;
  const angle = Math.atan2(ny, nx);
  const tangent = {
    x: sideSign * -Math.sin(angle),
    y: sideSign * Math.cos(angle),
  };
  const sideGate = smoothstep(0.08, 0.34, Math.abs(nx));
  const rimChannel = smoothstep(0.43, 0.78, radialDistance)
    * (1 - smoothstep(0.99, 1.08, radialDistance))
    * sideGate;
  const bottomReturn = gaussian(ny - 0.80, 0.26) * rimChannel;
  const inward = normalizedDirection(-nx, -ny);

  flowFrame.x += tangent.x * rimChannel * 0.066;
  flowFrame.y += tangent.y * rimChannel * 0.066;

  flowFrame.x += sideSign * topSplit * 0.052;
  flowFrame.y += topSplit * 0.016;

  flowFrame.x += inward.x * bottomReturn * 0.060;
  flowFrame.y += (inward.y * 0.42 - 0.58) * bottomReturn * 0.060;

  flowFrame.y += -centerChannel * 0.078;
  flowFrame.y += -bottomJet * 0.032;

  return endFlowSample(
    elapsed,
    0.0018 + rimChannel * 0.0042 + centerChannel * 0.0024,
    WAKE_EDDY_MIX,
    centerChannel + bottomJet * 0.48,
    rimChannel + topSplit * 0.55 + bottomReturn * 0.40,
    out,
  );
}

// A wall-jet ring that spins the whole basin around its center.
function sampleRingCurrent(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  elapsed: number,
  out: BasinCurrentSample,
): BasinCurrentSample {
  if (!beginFlowSample(point, poolRadius, bowlRadius, 0.96, 1.05)) {
    return setCurrentSample(out, 0, 0, 0, 0, 0);
  }

  const { radius, nx, ny, radialDistance, insideMask } = flowFrame;
  const radial = normalizedDirection(nx, ny);
  const tangent = { x: -radial.y, y: radial.x };
  const centerWidth = 0.24 + clamp(bowlRadius / radius, 0, 0.12) * 0.58;
  const centerChannel = gaussian(radialDistance, centerWidth) * 0.42;
  const rimChannel = smoothstep(0.43, 0.78, radialDistance)
    * (1 - smoothstep(0.99, 1.08, radialDistance))
    * insideMask;
  const midChannel = smoothstep(0.16, 0.54, radialDistance)
    * (1 - smoothstep(0.78, 0.98, radialDistance));

  flowFrame.x += tangent.x * (rimChannel * 0.074 + midChannel * 0.032 + centerChannel * 0.014);
  flowFrame.y += tangent.y * (rimChannel * 0.074 + midChannel * 0.032 + centerChannel * 0.014);
  flowFrame.x -= radial.x * rimChannel * 0.010;
  flowFrame.y -= radial.y * rimChannel * 0.010;

  addWallJets(RING_WALL_JETS, elapsed, 1);

  return endFlowSample(
    elapsed,
    0.0018 + rimChannel * 0.0042 + centerChannel * 0.0024,
    WAKE_EDDY_MIX,
    centerChannel + midChannel * 0.32,
    rimChannel,
    out,
  );
}

// Wall jets aimed at the center, where the intake swallows them.
function sampleSingularityCurrent(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  elapsed: number,
  out: BasinCurrentSample,
): BasinCurrentSample {
  if (!beginFlowSample(point, poolRadius, bowlRadius, 0.97, 1.05)) {
    return setCurrentSample(out, 0, 0, 0, 0, 0);
  }

  const { radius, nx, ny, radialDistance, insideMask } = flowFrame;
  const radial = normalizedDirection(nx, ny);
  const centerChannel = gaussian(radialDistance, 0.25 + clamp(bowlRadius / radius, 0, 0.12) * 0.58);
  const rimChannel = smoothstep(0.46, 0.80, radialDistance)
    * (1 - smoothstep(0.99, 1.07, radialDistance))
    * insideMask;
  const intakeChannel = smoothstep(0.12, 0.42, radialDistance)
    * (1 - smoothstep(0.93, 1.04, radialDistance))
    * insideMask;
  const centerSoftening = smoothstep(0.06, 0.22, radialDistance);
  const inwardSpeed = (rimChannel * 0.060 + intakeChannel * 0.056 + centerChannel * 0.014) * centerSoftening;

  flowFrame.x = -radial.x * inwardSpeed;
  flowFrame.y = -radial.y * inwardSpeed;

  addWallJets(SINGULARITY_WALL_JETS, elapsed, centerSoftening);

  return endFlowSample(
    elapsed,
    0.0014 + rimChannel * 0.0028 + intakeChannel * 0.0018,
    SINGULARITY_EDDY_MIX,
    centerChannel + intakeChannel * 0.36,
    rimChannel + intakeChannel * 0.20,
    out,
  );
}

export function sampleBasinCurrent(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  elapsed: number,
  shape: FlowShape = DEFAULT_FLOW_SHAPE,
  out: BasinCurrentSample = { x: 0, y: 0, energy: 0, centerChannel: 0, rimChannel: 0 },
): BasinCurrentSample {
  if (shape === "ring") {
    return sampleRingCurrent(point, poolRadius, bowlRadius, elapsed, out);
  }
  if (shape === "singularity") {
    return sampleSingularityCurrent(point, poolRadius, bowlRadius, elapsed, out);
  }

  return sampleCenteredCurrent(point, poolRadius, bowlRadius, elapsed, out);
}

function getCenteredJetSources(poolRadius: number): BasinJetSource[] {
  const radius = Math.max(poolRadius, 0.001);
  const centerBottomJetIndex = Math.floor(CENTERED_BOTTOM_OFFSETS.length / 2);
  const bottomJets = CENTERED_BOTTOM_OFFSETS.map((offset, index): BasinJetSource => {
    const position = wallPointForXOffset(offset, 1, radius);
    const direction = normalizedDirection(offset * -0.18, -1);
    return {
      x: position.x,
      y: position.y,
      directionX: direction.x,
      directionY: direction.y,
      radius: radius * 0.044,
      strength: 0.018 + (index === centerBottomJetIndex ? 0.004 : 0),
      markerLength: radius * 0.078,
      markerWidth: radius * 0.012,
      phase: index * 0.73,
    };
  });

  const topJets = CENTERED_TOP_OFFSETS.map((offset, index): BasinJetSource => {
    const side = offset < 0 ? -1 : 1;
    const position = wallPointForXOffset(offset, -1, radius);
    const direction = normalizedDirection(side * 0.88, 0.34);
    return {
      x: position.x,
      y: position.y,
      directionX: direction.x,
      directionY: direction.y,
      radius: radius * 0.044,
      strength: 0.023,
      markerLength: radius * 0.070,
      markerWidth: radius * 0.011,
      phase: 2.4 + index * 0.81,
    };
  });

  return [...bottomJets, ...topJets];
}

function getRingJetSources(poolRadius: number): BasinJetSource[] {
  const radius = Math.max(poolRadius, 0.001);
  return RING_JET_ANGLES.map((angle, index): BasinJetSource => {
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const direction = ringJetDirection(radialX, radialY);
    const alternatingStrength = index % 2 === 0 ? 0.004 : 0;

    return {
      x: radialX * radius * WALL_JET_RADIUS_RATIO,
      y: radialY * radius * WALL_JET_RADIUS_RATIO,
      directionX: direction.x,
      directionY: direction.y,
      radius: radius * (0.052 + (index % 3) * 0.004),
      strength: 0.026 + alternatingStrength,
      markerLength: radius * 0.076,
      markerWidth: radius * 0.012,
      phase: index * 0.79,
    };
  });
}

function getSingularityJetSources(poolRadius: number): BasinJetSource[] {
  const radius = Math.max(poolRadius, 0.001);
  return SINGULARITY_JET_ANGLES.map((angle, index): BasinJetSource => {
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const direction = normalizedDirection(-radialX, -radialY);
    const alternatingStrength = index % 2 === 0 ? 0.003 : 0;

    return {
      x: radialX * radius * WALL_JET_RADIUS_RATIO,
      y: radialY * radius * WALL_JET_RADIUS_RATIO,
      directionX: direction.x,
      directionY: direction.y,
      radius: radius * (0.050 + (index % 3) * 0.004),
      strength: 0.027 + alternatingStrength,
      markerLength: radius * 0.084,
      markerWidth: radius * 0.012,
      phase: 1.2 + index * 0.77,
    };
  });
}

export function getBasinJetSources(
  poolRadius: number,
  shape: FlowShape = DEFAULT_FLOW_SHAPE,
): BasinJetSource[] {
  if (shape === "ring") {
    return getRingJetSources(poolRadius);
  }
  if (shape === "singularity") {
    return getSingularityJetSources(poolRadius);
  }

  return getCenteredJetSources(poolRadius);
}
