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

function sampleCenteredCurrent(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  elapsed: number,
  out: BasinCurrentSample,
): BasinCurrentSample {
  const radius = Math.max(poolRadius, 0.001);
  const nx = point.x / radius;
  const ny = point.y / radius;
  const radialDistance = Math.hypot(nx, ny);
  const insideMask = 1 - smoothstep(0.97, 1.05, radialDistance);

  if (insideMask <= 0) {
    return setCurrentSample(out, 0, 0, 0, 0, 0);
  }

  const bowlDrag = clamp(1.12 - bowlRadius * 0.44, 0.76, 1.04);
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

  let x = 0;
  let y = 0;

  x += tangent.x * rimChannel * 0.066;
  y += tangent.y * rimChannel * 0.066;

  x += sideSign * topSplit * 0.052;
  y += topSplit * 0.016;

  x += inward.x * bottomReturn * 0.060;
  y += (inward.y * 0.42 - 0.58) * bottomReturn * 0.060;

  y += -centerChannel * 0.078;
  y += -bottomJet * 0.032;

  const eddyA = Math.sin((nx * 2.35 - ny * 1.75) * TAU + elapsed * 0.31);
  const eddyB = Math.cos((nx * 1.15 + ny * 2.60) * TAU - elapsed * 0.27);
  const eddyStrength = (0.0018 + rimChannel * 0.0042 + centerChannel * 0.0024) * insideMask;
  x += (eddyA * 0.72 + eddyB * 0.28) * eddyStrength;
  y += (eddyB * 0.64 - eddyA * 0.22) * eddyStrength;

  x *= insideMask * bowlDrag;
  y *= insideMask * bowlDrag;

  return setCurrentSample(
    out,
    x,
    y,
    clamp(Math.hypot(x, y) / 0.090, 0, 1),
    clamp(centerChannel + bottomJet * 0.48, 0, 1),
    clamp(rimChannel + topSplit * 0.55 + bottomReturn * 0.40, 0, 1),
  );
}

function sampleRingCurrent(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  elapsed: number,
  out: BasinCurrentSample,
): BasinCurrentSample {
  const radius = Math.max(poolRadius, 0.001);
  const nx = point.x / radius;
  const ny = point.y / radius;
  const radialDistance = Math.hypot(nx, ny);
  const insideMask = 1 - smoothstep(0.96, 1.05, radialDistance);

  if (insideMask <= 0) {
    return setCurrentSample(out, 0, 0, 0, 0, 0);
  }

  const bowlDrag = clamp(1.12 - bowlRadius * 0.44, 0.76, 1.04);
  const radial = normalizedDirection(nx, ny);
  const tangent = { x: -radial.y, y: radial.x };
  const centerWidth = 0.24 + clamp(bowlRadius / radius, 0, 0.12) * 0.58;
  const centerChannel = gaussian(radialDistance, centerWidth) * 0.42;
  const rimChannel = smoothstep(0.43, 0.78, radialDistance)
    * (1 - smoothstep(0.99, 1.08, radialDistance))
    * insideMask;
  const midChannel = smoothstep(0.16, 0.54, radialDistance)
    * (1 - smoothstep(0.78, 0.98, radialDistance));

  let x = 0;
  let y = 0;

  x += tangent.x * (rimChannel * 0.074 + midChannel * 0.032 + centerChannel * 0.014);
  y += tangent.y * (rimChannel * 0.074 + midChannel * 0.032 + centerChannel * 0.014);
  x -= radial.x * rimChannel * 0.010;
  y -= radial.y * rimChannel * 0.010;

  for (let i = 0; i < RING_JET_ANGLES.length; i += 1) {
    const angle = RING_JET_ANGLES[i];
    const sourceX = Math.cos(angle) * WALL_JET_RADIUS_RATIO;
    const sourceY = Math.sin(angle) * WALL_JET_RADIUS_RATIO;
    const sourceRadial = normalizedDirection(sourceX, sourceY);
    const direction = ringJetDirection(sourceRadial.x, sourceRadial.y);
    const cross = { x: -direction.y, y: direction.x };
    const offsetX = nx - sourceX;
    const offsetY = ny - sourceY;
    const along = offsetX * direction.x + offsetY * direction.y;
    const across = offsetX * cross.x + offsetY * cross.y;
    const downstream = smoothstep(-0.018, 0.090, along);
    const plume = downstream
      * gaussian(across, 0.115)
      * Math.exp(-Math.max(along, 0) / 0.58)
      * insideMask;
    const pulse = 0.84 + Math.sin(elapsed * 0.46 + i * 0.91) * 0.10;

    x += direction.x * plume * 0.064 * pulse;
    y += direction.y * plume * 0.064 * pulse;
  }

  const eddyA = Math.sin((nx * 2.35 - ny * 1.75) * TAU + elapsed * 0.31);
  const eddyB = Math.cos((nx * 1.15 + ny * 2.60) * TAU - elapsed * 0.27);
  const eddyStrength = (0.0018 + rimChannel * 0.0042 + centerChannel * 0.0024) * insideMask;
  x += (eddyA * 0.72 + eddyB * 0.28) * eddyStrength;
  y += (eddyB * 0.64 - eddyA * 0.22) * eddyStrength;

  x *= insideMask * bowlDrag;
  y *= insideMask * bowlDrag;

  return setCurrentSample(
    out,
    x,
    y,
    clamp(Math.hypot(x, y) / 0.090, 0, 1),
    clamp(centerChannel + midChannel * 0.32, 0, 1),
    clamp(rimChannel, 0, 1),
  );
}

function sampleSingularityCurrent(
  point: FlowPoint,
  poolRadius: number,
  bowlRadius: number,
  elapsed: number,
  out: BasinCurrentSample,
): BasinCurrentSample {
  const radius = Math.max(poolRadius, 0.001);
  const nx = point.x / radius;
  const ny = point.y / radius;
  const radialDistance = Math.hypot(nx, ny);
  const insideMask = 1 - smoothstep(0.97, 1.05, radialDistance);

  if (insideMask <= 0) {
    return setCurrentSample(out, 0, 0, 0, 0, 0);
  }

  const bowlDrag = clamp(1.12 - bowlRadius * 0.44, 0.76, 1.04);
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

  let x = -radial.x * inwardSpeed;
  let y = -radial.y * inwardSpeed;

  for (let i = 0; i < SINGULARITY_JET_ANGLES.length; i += 1) {
    const angle = SINGULARITY_JET_ANGLES[i];
    const sourceX = Math.cos(angle) * WALL_JET_RADIUS_RATIO;
    const sourceY = Math.sin(angle) * WALL_JET_RADIUS_RATIO;
    const direction = normalizedDirection(-sourceX, -sourceY);
    const cross = { x: -direction.y, y: direction.x };
    const offsetX = nx - sourceX;
    const offsetY = ny - sourceY;
    const along = offsetX * direction.x + offsetY * direction.y;
    const across = offsetX * cross.x + offsetY * cross.y;
    const downstream = smoothstep(-0.016, 0.082, along);
    const plume = downstream
      * gaussian(across, 0.118)
      * Math.exp(-Math.max(along, 0) / 0.70)
      * insideMask
      * centerSoftening;
    const pulse = 0.86 + Math.sin(elapsed * 0.52 + i * 0.83) * 0.10;

    x += direction.x * plume * 0.060 * pulse;
    y += direction.y * plume * 0.060 * pulse;
  }

  const eddyA = Math.sin((nx * 2.35 - ny * 1.75) * TAU + elapsed * 0.31);
  const eddyB = Math.cos((nx * 1.15 + ny * 2.60) * TAU - elapsed * 0.27);
  const eddyStrength = (0.0014 + rimChannel * 0.0028 + intakeChannel * 0.0018) * insideMask;
  x += (eddyA * 0.66 + eddyB * 0.24) * eddyStrength;
  y += (eddyB * 0.58 - eddyA * 0.18) * eddyStrength;

  x *= insideMask * bowlDrag;
  y *= insideMask * bowlDrag;

  return setCurrentSample(
    out,
    x,
    y,
    clamp(Math.hypot(x, y) / 0.090, 0, 1),
    clamp(centerChannel + intakeChannel * 0.36, 0, 1),
    clamp(rimChannel + intakeChannel * 0.20, 0, 1),
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
