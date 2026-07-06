export type BowlCollisionBody = {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  massRadius: number;
  contactRadius: number;
  inverseMass: number;
};

export type BowlContactState = {
  lastSeenAt: number;
};

export type BowlCollisionSettings = {
  iterations: number;
  contactPadding: number;
  contactSlop: number;
  releaseDistance: number;
  heightMismatchInset: number;
  restitution: number;
  correctionPercent: number;
  impactSpeedFloor: number;
};

export type BowlCollisionEvent = {
  aId: number;
  bId: number;
  contactX: number;
  contactZ: number;
  normalX: number;
  normalZ: number;
  overlap: number;
  relativeSpeed: number;
  closingSpeed: number;
  impactMomentum: number;
  strength: number;
};

export const DEFAULT_BOWL_COLLISION_SETTINGS: BowlCollisionSettings = {
  iterations: 4,
  contactPadding: 0.004,
  contactSlop: 0.004,
  releaseDistance: 0.055,
  heightMismatchInset: 0.16,
  restitution: 0.38,
  correctionPercent: 0.86,
  impactSpeedFloor: 0.004,
};

const bowlContactRadiusScale = 1.0;
const epsilon = 0.000001;

export function getBowlContactRadius(visualRadius: number) {
  return Math.max(0.001, visualRadius * bowlContactRadiusScale);
}

export function getBowlPairKey(aId: number, bId: number) {
  const minId = Math.min(aId, bId);
  const maxId = Math.max(aId, bId);
  const sum = minId + maxId;
  return (sum * (sum + 1)) / 2 + maxId;
}

export function getBowlPairImpactMomentum(
  aMassRadius: number,
  bMassRadius: number,
  closingSpeed: number,
) {
  const reducedRadius = (aMassRadius * bMassRadius) / Math.max(aMassRadius + bMassRadius, epsilon);
  return Math.max(0, closingSpeed) * reducedRadius;
}

export function getCollisionRippleStrength(
  separatingSpeed: number,
  relativeSpeed: number,
  overlap: number,
) {
  const contactSpeed = Math.max(Math.abs(separatingSpeed), relativeSpeed * 0.24);
  const contactEnergy = contactSpeed * 2.0 + overlap * 2.2;
  return clamp(0.10 + Math.sqrt(Math.max(0, contactEnergy)) * 0.22, 0.10, 0.44);
}

export function resolveBowlContacts(
  bodies: BowlCollisionBody[],
  contactStates: Map<number, BowlContactState>,
  now: number,
  settings: BowlCollisionSettings = DEFAULT_BOWL_COLLISION_SETTINGS,
) {
  const events: BowlCollisionEvent[] = [];
  const iterationCount = Math.max(1, Math.floor(settings.iterations));

  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const emitEvents = iteration === 0;

    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i];
        const b = bodies[j];
        const contact = measureContact(a, b, settings);

        if (emitEvents) {
          updateContactState(events, contactStates, now, a, b, contact, settings);
        }

        if (contact.overlap <= 0) {
          continue;
        }

        resolvePenetration(a, b, contact.normalX, contact.normalZ, contact.overlap, settings);
        resolveClosingVelocity(a, b, contact.normalX, contact.normalZ, settings);
      }
    }
  }

  return events;
}

function updateContactState(
  events: BowlCollisionEvent[],
  contactStates: Map<number, BowlContactState>,
  now: number,
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  contact: ReturnType<typeof measureContact>,
  settings: BowlCollisionSettings,
) {
  const key = getBowlPairKey(a.id, b.id);
  const existing = contactStates.get(key);

  if (contact.overlap > 0) {
      if (existing) {
        existing.lastSeenAt = now;
      } else {
        contactStates.set(key, { lastSeenAt: now });
      }

      if (!existing && contact.closingSpeed >= settings.impactSpeedFloor) {
      events.push({
        aId: a.id,
        bId: b.id,
        contactX: contact.contactX,
        contactZ: contact.contactZ,
        normalX: contact.normalX,
        normalZ: contact.normalZ,
        overlap: contact.overlap,
        relativeSpeed: contact.relativeSpeed,
        closingSpeed: contact.closingSpeed,
        impactMomentum: getBowlPairImpactMomentum(a.massRadius, b.massRadius, contact.closingSpeed),
        strength: getCollisionRippleStrength(
          contact.separatingSpeed,
          contact.relativeSpeed,
          contact.overlap,
        ),
      });
    }

    return;
  }

  if (existing && contact.distance <= contact.contactDistance + settings.releaseDistance) {
    existing.lastSeenAt = now;
    return;
  }

  contactStates.delete(key);
}

function measureContact(
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  settings: BowlCollisionSettings,
) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distance = Math.hypot(dx, dz);
  const { normalX, normalZ } = getContactNormal(a, b, dx, dz, distance);
  const contactDistance = getContactDistance(a, b, settings);
  const overlap = contactDistance - distance;
  const relativeVelocityX = b.vx - a.vx;
  const relativeVelocityZ = b.vz - a.vz;
  const relativeSpeed = Math.hypot(relativeVelocityX, relativeVelocityZ);
  const separatingSpeed = relativeVelocityX * normalX + relativeVelocityZ * normalZ;
  const closingSpeed = Math.max(0, -separatingSpeed);
  const aContactX = a.x + normalX * a.contactRadius;
  const aContactZ = a.z + normalZ * a.contactRadius;
  const bContactX = b.x - normalX * b.contactRadius;
  const bContactZ = b.z - normalZ * b.contactRadius;

  return {
    normalX,
    normalZ,
    distance,
    contactDistance,
    overlap,
    relativeSpeed,
    separatingSpeed,
    closingSpeed,
    contactX: (aContactX + bContactX) * 0.5,
    contactZ: (aContactZ + bContactZ) * 0.5,
  };
}

function getContactDistance(
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  settings: BowlCollisionSettings,
) {
  const sizeMismatch = Math.abs(a.massRadius - b.massRadius) / Math.max(a.massRadius + b.massRadius, epsilon);
  const mismatchInset = Math.min(a.contactRadius, b.contactRadius) * sizeMismatch * settings.heightMismatchInset;
  return a.contactRadius + b.contactRadius + settings.contactPadding - mismatchInset;
}

function resolvePenetration(
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  normalX: number,
  normalZ: number,
  overlap: number,
  settings: BowlCollisionSettings,
) {
  const inverseMassSum = a.inverseMass + b.inverseMass;
  if (inverseMassSum <= epsilon) {
    return;
  }

  const correction = Math.max(0, overlap - settings.contactSlop) * settings.correctionPercent;
  if (correction <= 0) {
    return;
  }

  const aShare = a.inverseMass / inverseMassSum;
  const bShare = b.inverseMass / inverseMassSum;
  a.x -= normalX * correction * aShare;
  a.z -= normalZ * correction * aShare;
  b.x += normalX * correction * bShare;
  b.z += normalZ * correction * bShare;
}

function resolveClosingVelocity(
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  normalX: number,
  normalZ: number,
  settings: BowlCollisionSettings,
) {
  const inverseMassSum = a.inverseMass + b.inverseMass;
  if (inverseMassSum <= epsilon) {
    return;
  }

  const relativeVelocityX = b.vx - a.vx;
  const relativeVelocityZ = b.vz - a.vz;
  const separatingSpeed = relativeVelocityX * normalX + relativeVelocityZ * normalZ;
  if (separatingSpeed >= 0) {
    return;
  }

  const impulse = (-(1 + settings.restitution) * separatingSpeed) / inverseMassSum;
  if (a.inverseMass > 0) {
    a.vx -= normalX * impulse * a.inverseMass;
    a.vz -= normalZ * impulse * a.inverseMass;
  }
  if (b.inverseMass > 0) {
    b.vx += normalX * impulse * b.inverseMass;
    b.vz += normalZ * impulse * b.inverseMass;
  }
}

function getContactNormal(
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  dx: number,
  dz: number,
  distance: number,
) {
  if (distance > epsilon) {
    return {
      normalX: dx / distance,
      normalZ: dz / distance,
    };
  }

  const relativeVelocityX = b.vx - a.vx;
  const relativeVelocityZ = b.vz - a.vz;
  const relativeSpeed = Math.hypot(relativeVelocityX, relativeVelocityZ);
  if (relativeSpeed > epsilon) {
    return {
      normalX: relativeVelocityX / relativeSpeed,
      normalZ: relativeVelocityZ / relativeSpeed,
    };
  }

  const angle = ((a.id * 12.9898 + b.id * 78.233) % 1) * Math.PI * 2;
  return {
    normalX: Math.cos(angle),
    normalZ: Math.sin(angle),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
