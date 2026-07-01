export type CircularBoundaryContactInput = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  centerLimit: number;
  restitution: number;
  impactSpeedFloor: number;
};

export type CircularBoundaryContact = {
  hit: boolean;
  normalX: number;
  normalZ: number;
  nextX: number;
  nextZ: number;
  nextVx: number;
  nextVz: number;
  outwardSpeed: number;
  impactMomentum: number;
  impactStrength: number;
  shouldEmitImpact: boolean;
};

const epsilon = 0.0001;

export function resolveCircularBoundaryContact(input: CircularBoundaryContactInput): CircularBoundaryContact {
  const distance = Math.hypot(input.x, input.z);

  if (distance <= input.centerLimit) {
    return {
      hit: false,
      normalX: 0,
      normalZ: 0,
      nextX: input.x,
      nextZ: input.z,
      nextVx: input.vx,
      nextVz: input.vz,
      outwardSpeed: 0,
      impactMomentum: 0,
      impactStrength: 0,
      shouldEmitImpact: false,
    };
  }

  const normalX = distance > epsilon ? input.x / distance : 1;
  const normalZ = distance > epsilon ? input.z / distance : 0;
  const outwardSpeed = input.vx * normalX + input.vz * normalZ;
  const impactStrength = Math.max(Math.abs(outwardSpeed), Math.hypot(input.vx, input.vz) * 0.24);
  const impactMomentum = Math.max(0, outwardSpeed) * input.radius;
  let nextVx = input.vx;
  let nextVz = input.vz;

  if (outwardSpeed > 0) {
    nextVx -= normalX * (1 + input.restitution) * outwardSpeed;
    nextVz -= normalZ * (1 + input.restitution) * outwardSpeed;
  } else if (input.restitution === 0) {
    nextVx -= normalX * outwardSpeed;
    nextVz -= normalZ * outwardSpeed;
  }

  return {
    hit: true,
    normalX,
    normalZ,
    nextX: normalX * input.centerLimit,
    nextZ: normalZ * input.centerLimit,
    nextVx,
    nextVz,
    outwardSpeed,
    impactMomentum,
    impactStrength,
    shouldEmitImpact: outwardSpeed > input.impactSpeedFloor && impactStrength > 0,
  };
}
