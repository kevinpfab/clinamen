// Iterative overlap relaxation for a set of discs confined to a circle.
//
// Used for the one-time startup layout: the spawn scatter places bowls cheaply
// and this pass pushes apart whatever it happened to overlap. It is not the
// runtime collision solver (physics/collision.ts) — there is no velocity here,
// only positions, because at layout time nothing is moving yet.

export type SeparationBody = {
  x: number;
  z: number;
  contactRadius: number;
  // How far this body's center may sit from the origin.
  centerLimit: number;
  // Pinned bodies never move; an overlapping partner takes the whole
  // correction. The intro pins its hero bowl at the pool center this way.
  pinned?: boolean;
};

export type SeparationOptions = {
  // Extra clearance beyond the two contact radii.
  padding: number;
  maxIterations: number;
  // Fraction of the overlap each of two free bodies takes. Slightly over half
  // so a chain of contacts converges instead of shuffling.
  relaxation?: number;
  // Stable fallback direction for exactly coincident bodies, in radians.
  angleFor?: (aIndex: number, bIndex: number, iteration: number) => number;
};

const coincidentEpsilon = 0.001;

// Pushing a pair to exactly `gap` frequently lands a bit under it once the
// distance is recomputed in floating point, so an exact `distance >= gap` test
// never converges — it keeps correcting overlaps of ~1e-16 forever. A pair is
// separated once it is within this much of the target, which is three orders of
// magnitude below the collision solver's own contact slop.
export const separationTolerance = 0.000001;

function clampToLimit(body: SeparationBody) {
  const length = Math.hypot(body.x, body.z);
  if (length <= body.centerLimit || length < coincidentEpsilon) {
    return;
  }

  const scale = body.centerLimit / length;
  body.x *= scale;
  body.z *= scale;
}

// Relaxes `bodies` in place. Returns the number of iterations run — 0 when the
// layout was already separated, `maxIterations` when it did not converge.
export function separateBodies(
  bodies: SeparationBody[],
  options: SeparationOptions,
): number {
  const relaxation = options.relaxation ?? 0.55;
  const angleFor = options.angleFor ?? ((aIndex, bIndex, iteration) =>
    (aIndex * 13.7 + bIndex * 3.1 + iteration * 0.7) % (Math.PI * 2));

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    let separated = true;

    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.pinned && b.pinned) {
          continue;
        }

        const gap = a.contactRadius + b.contactRadius + options.padding;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= gap - separationTolerance) {
          continue;
        }

        separated = false;
        let normalX: number;
        let normalZ: number;
        if (distance > coincidentEpsilon) {
          normalX = dx / distance;
          normalZ = dz / distance;
        } else {
          const angle = angleFor(i, j, iteration);
          normalX = Math.cos(angle);
          normalZ = Math.sin(angle);
        }

        const shortfall = gap - distance;
        if (a.pinned || b.pinned) {
          const mover = a.pinned ? b : a;
          const sign = a.pinned ? 1 : -1;
          mover.x += normalX * shortfall * sign;
          mover.z += normalZ * shortfall * sign;
          clampToLimit(mover);
          continue;
        }

        const push = shortfall * relaxation;
        a.x -= normalX * push;
        a.z -= normalZ * push;
        b.x += normalX * push;
        b.z += normalZ * push;
        clampToLimit(a);
        clampToLimit(b);
      }
    }

    if (separated) {
      return iteration;
    }
  }

  return options.maxIterations;
}
