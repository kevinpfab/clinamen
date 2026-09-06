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
  // Which resolveBowlContacts pass last touched this pair. The broadphase skips
  // pairs that are obviously apart, so they can no longer clear their own state
  // — instead every surviving pair is stamped and the leftovers are swept after
  // the pass. Left optional so callers can seed a map without knowing the
  // counter; an unstamped entry is simply treated as stale.
  lastSeenPass?: number;
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
  rippleStrength: number;
};

export const DEFAULT_BOWL_COLLISION_SETTINGS: BowlCollisionSettings = {
  iterations: 4,
  contactPadding: 0.004,
  contactSlop: 0.004,
  releaseDistance: 0.055,
  heightMismatchInset: 0.16,
  restitution: 0.52,
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
  return clamp(Math.sqrt(Math.max(0, contactEnergy)) * 0.22, 0, 0.44);
}

// Resonance/audio retain their established audible response while the water
// receives a continuously scaled pressure impulse without a minimum splash.
function getCollisionImpactStrength(separatingSpeed: number, relativeSpeed: number, overlap: number) {
  return clamp(0.10 + getCollisionRippleStrength(separatingSpeed, relativeSpeed, overlap), 0.10, 0.44);
}

let contactPass = 0;

export function resolveBowlContacts(
  bodies: BowlCollisionBody[],
  contactStates: Map<number, BowlContactState>,
  now: number,
  settings: BowlCollisionSettings = DEFAULT_BOWL_COLLISION_SETTINGS,
) {
  const events: BowlCollisionEvent[] = [];
  const iterationCount = Math.max(1, Math.floor(settings.iterations));
  contactPass += 1;
  const pass = contactPass;

  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const emitEvents = iteration === 0;
    // Broadphase margin. getContactDistance only ever subtracts from
    // (aRadius + bRadius + contactPadding), so nothing beyond that sum can
    // overlap. The event-emitting pass looks further out because
    // updateContactState keeps a separated pair alive across releaseDistance.
    const rejectMargin = emitEvents
      ? settings.contactPadding + settings.releaseDistance
      : settings.contactPadding;

    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const rejectDistance = a.contactRadius + b.contactRadius + rejectMargin;
        if (dx * dx + dz * dz > rejectDistance * rejectDistance) {
          continue;
        }

        const contact = measureContact(a, b, dx, dz, settings);

        if (emitEvents) {
          updateContactState(events, contactStates, now, pass, a, b, contact, settings);
        }

        if (contact.overlap <= 0) {
          continue;
        }

        resolvePenetration(a, b, contact.normalX, contact.normalZ, contact.overlap, settings);
        resolveClosingVelocity(a, b, contact.normalX, contact.normalZ, settings);
      }
    }

    if (emitEvents) {
      pruneReleasedContacts(contactStates, pass);
    }
  }

  return events;
}

// Any pair the event pass did not stamp is either out of the broadphase radius
// or past its release band, so its contact is over.
function pruneReleasedContacts(contactStates: Map<number, BowlContactState>, pass: number) {
  for (const [key, state] of contactStates) {
    if (state.lastSeenPass !== pass) {
      contactStates.delete(key);
    }
  }
}

function updateContactState(
  events: BowlCollisionEvent[],
  contactStates: Map<number, BowlContactState>,
  now: number,
  pass: number,
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  contact: ContactMeasurement,
  settings: BowlCollisionSettings,
) {
  const key = getBowlPairKey(a.id, b.id);
  const existing = contactStates.get(key);

  if (contact.overlap > 0) {
    if (existing) {
      existing.lastSeenAt = now;
      existing.lastSeenPass = pass;
      return;
    }

    contactStates.set(key, { lastSeenAt: now, lastSeenPass: pass });
    if (contact.closingSpeed >= settings.impactSpeedFloor) {
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
        strength: getCollisionImpactStrength(
          contact.separatingSpeed,
          contact.relativeSpeed,
          contact.overlap,
        ),
        rippleStrength: getCollisionRippleStrength(
          contact.separatingSpeed,
          contact.relativeSpeed,
          contact.overlap,
        ),
      });
    }

    return;
  }

  // Hysteresis: a pair that has drifted apart but is still inside the release
  // band stays in contact, so resting bowls do not re-trigger an impact every
  // time they jitter across the contact distance. Anything not stamped here is
  // swept by pruneReleasedContacts.
  if (existing && contact.distance <= contact.contactDistance + settings.releaseDistance) {
    existing.lastSeenAt = now;
    existing.lastSeenPass = pass;
  }
}

type ContactMeasurement = {
  normalX: number;
  normalZ: number;
  distance: number;
  contactDistance: number;
  overlap: number;
  relativeSpeed: number;
  separatingSpeed: number;
  closingSpeed: number;
  contactX: number;
  contactZ: number;
};

// The pair loop measures thousands of contacts per frame and consumes each one
// before the next is taken, so measurements are written into a single scratch
// record rather than allocated.
const contactMeasurement: ContactMeasurement = {
  normalX: 0,
  normalZ: 0,
  distance: 0,
  contactDistance: 0,
  overlap: 0,
  relativeSpeed: 0,
  separatingSpeed: 0,
  closingSpeed: 0,
  contactX: 0,
  contactZ: 0,
};

function measureContact(
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  dx: number,
  dz: number,
  settings: BowlCollisionSettings,
): ContactMeasurement {
  const measurement = contactMeasurement;
  const distance = Math.hypot(dx, dz);
  writeContactNormal(measurement, a, b, dx, dz, distance);
  const { normalX, normalZ } = measurement;
  const contactDistance = getContactDistance(a, b, settings);
  const relativeVelocityX = b.vx - a.vx;
  const relativeVelocityZ = b.vz - a.vz;
  const separatingSpeed = relativeVelocityX * normalX + relativeVelocityZ * normalZ;
  const aContactX = a.x + normalX * a.contactRadius;
  const aContactZ = a.z + normalZ * a.contactRadius;
  const bContactX = b.x - normalX * b.contactRadius;
  const bContactZ = b.z - normalZ * b.contactRadius;

  measurement.distance = distance;
  measurement.contactDistance = contactDistance;
  measurement.overlap = contactDistance - distance;
  measurement.relativeSpeed = Math.hypot(relativeVelocityX, relativeVelocityZ);
  measurement.separatingSpeed = separatingSpeed;
  measurement.closingSpeed = Math.max(0, -separatingSpeed);
  measurement.contactX = (aContactX + bContactX) * 0.5;
  measurement.contactZ = (aContactZ + bContactZ) * 0.5;
  return measurement;
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

function writeContactNormal(
  target: ContactMeasurement,
  a: BowlCollisionBody,
  b: BowlCollisionBody,
  dx: number,
  dz: number,
  distance: number,
) {
  if (distance > epsilon) {
    target.normalX = dx / distance;
    target.normalZ = dz / distance;
    return;
  }

  const relativeVelocityX = b.vx - a.vx;
  const relativeVelocityZ = b.vz - a.vz;
  const relativeSpeed = Math.hypot(relativeVelocityX, relativeVelocityZ);
  if (relativeSpeed > epsilon) {
    target.normalX = relativeVelocityX / relativeSpeed;
    target.normalZ = relativeVelocityZ / relativeSpeed;
    return;
  }

  const angle = ((a.id * 12.9898 + b.id * 78.233) % 1) * Math.PI * 2;
  target.normalX = Math.cos(angle);
  target.normalZ = Math.sin(angle);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
