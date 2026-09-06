import * as THREE from "three";
import {
  bowlImpactCooldown,
  velocityWorldScale,
} from "../config";
import {
  bowlCollisionSettings,
  debugSettings,
  simulationSettings,
} from "../settings";
import type { EventBus, BasinEvents } from "../core/events";
import { pseudoRandom } from "../core/math";
import { getWaterSurfaceRadius } from "../core/world";
import {
  getBowlContactRadius,
  resolveBowlContacts,
  type BowlCollisionBody,
  type BowlCollisionEvent,
  type BowlContactState,
} from "../physics/collision";
import { resolveCircularBoundaryContact } from "../physics/bounds";
import { separateBodies, type SeparationBody } from "../physics/separation";
import { sampleBasinCurrent, type BasinCurrentSample } from "../physics/flow";
import { getBowlPlaneY } from "./profile";
import type { BowlBody } from "./types";
import { createBowlInstanceRenderer, type BowlInstanceRenderer } from "./instances";
import { goldenAngle, scatterBowlPosition } from "./layout";
import { bowlResonancePulseLifetime, type BowlMaterials } from "./materials";
import { triggerBowlResonance, updateBowlResonance } from "./resonance";
import {
  getBowlCenterLimit,
  getBowlRadius,
  getToneRatio,
} from "./tuning";

export type BowlSystem = {
  bowls: BowlBody[];
  setFrozen: (frozen: boolean) => void;
  rebuild: () => void;
  update: (delta: number, elapsed: number, draggedBowl: BowlBody | null) => void;
  resolveCollisions: (now: number, draggedBowl: BowlBody | null) => void;
  updateResonance: (delta: number) => void;
  updateInstances: () => void;
  findAtPoint: (point: THREE.Vector2) => BowlBody | null;
  clampPointToBounds: (bowl: BowlBody, point: THREE.Vector2) => THREE.Vector2;
  keepAllInsideBounds: () => void;
  keepInsideBounds: (bowl: BowlBody, restitution?: number) => void;
  addMomentum: (bowl: BowlBody, strength: number) => void;
  // Relaxes overlaps out of the current layout, optionally holding one bowl
  // still. The intro calls this after moving its hero bowl to the pool center.
  separate: (pinned?: BowlBody | null) => void;
  dispose: () => void;
};

type BowlSystemDeps = {
  bus: EventBus<BasinEvents>;
  scene: THREE.Scene;
  materials: BowlMaterials;
};

const bowlMomentumDecayRate = 0.38;
const maxBowlMomentumStrength = 1;

// Layout relaxation. The clearance matches the collision solver's own contact
// padding closely enough that a separated layout does not immediately generate
// contact events on the first simulated frame.
const layoutClearance = 0.06;
const layoutRelaxationIterations = 120;

export function createBowlSystem({ bus, scene, materials }: BowlSystemDeps): BowlSystem {
  let bowls: BowlBody[] = [];
  // While frozen (the intro, until every bowl has surfaced) bowls only spin
  // in place: no drift, no collisions. The simulation then starts as one
  // moment instead of bowl by bowl.
  let frozen = false;
  let instances: BowlInstanceRenderer | null = null;

  const contactStates = new Map<number, BowlContactState>();
  const collisionBodies: BowlCollisionBody[] = [];
  const currentSample: BasinCurrentSample = {
    x: 0,
    y: 0,
    energy: 0,
    centerChannel: 0,
    rimChannel: 0,
  };
  const currentVelocity = new THREE.Vector2();
  const scratchNormal = new THREE.Vector2();

  function canPlayImpactTone(impactMomentum: number) {
    return impactMomentum >= debugSettings.impactMomentumFloor;
  }

  function addMomentum(bowl: BowlBody, strength: number) {
    bowl.momentumStrength = Math.max(
      bowl.momentumStrength,
      THREE.MathUtils.clamp(strength, 0, maxBowlMomentumStrength),
    );
  }

  function keepInsideBounds(bowl: BowlBody, restitution = 0.76) {
    const poolRadius = getWaterSurfaceRadius();
    const contact = resolveCircularBoundaryContact({
      x: bowl.mesh.position.x,
      z: bowl.mesh.position.z,
      vx: bowl.velocity.x,
      vz: bowl.velocity.y,
      radius: bowl.radius,
      centerLimit: getBowlCenterLimit(bowl.radius, poolRadius),
      restitution,
      impactSpeedFloor: bowlCollisionSettings.impactSpeedFloor,
    });

    if (!contact.hit) {
      return;
    }

    bowl.mesh.position.x = contact.nextX;
    bowl.mesh.position.z = contact.nextZ;
    bowl.velocity.set(contact.nextVx, contact.nextVz);

    if (!contact.shouldEmitImpact || restitution <= 0) {
      return;
    }

    addMomentum(bowl, contact.impactStrength * 2.6);
    bus.emit("ripple", {
      x: contact.normalX * poolRadius,
      z: contact.normalZ * poolRadius,
      strength: THREE.MathUtils.clamp(
        0.18 + Math.sqrt(Math.max(0, contact.impactStrength)) * 0.18,
        0.18,
        0.42,
      ),
      direction: scratchNormal.set(-contact.normalX, -contact.normalZ),
    });
    if (canPlayImpactTone(contact.impactMomentum)) {
      triggerBowlResonance(bowl, contact.impactStrength * 1.8, scratchNormal.set(contact.normalX, contact.normalZ));
      bus.emit("tone", { sizeRatio: bowl.toneRatio, strength: contact.impactStrength });
    }
  }

  function separate(pinned: BowlBody | null = null) {
    if (bowls.length < 2) {
      return;
    }

    const poolRadius = getWaterSurfaceRadius();
    const layout: SeparationBody[] = bowls.map((bowl) => ({
      x: bowl.mesh.position.x,
      z: bowl.mesh.position.z,
      contactRadius: bowl.contactRadius,
      centerLimit: getBowlCenterLimit(bowl.radius, poolRadius),
      pinned: bowl === pinned,
    }));

    separateBodies(layout, {
      padding: layoutClearance,
      maxIterations: layoutRelaxationIterations,
      angleFor: (aIndex, bIndex, iteration) =>
        pseudoRandom(bowls[aIndex].id * 13.7 + bowls[bIndex].id * 3.1 + iteration * 0.7) * Math.PI * 2,
    });

    for (let i = 0; i < bowls.length; i += 1) {
      bowls[i].mesh.position.x = layout[i].x;
      bowls[i].mesh.position.z = layout[i].z;
    }
  }

  function disposeInstances() {
    if (!instances) {
      return;
    }

    scene.remove(...instances.objects);
    instances.dispose();
    instances = null;
  }

  function createBowls(): BowlBody[] {
    const count = simulationSettings.bowlCount;
    const poolRadius = getWaterSurfaceRadius();
    const bodies: BowlBody[] = [];
    const renderer = createBowlInstanceRenderer(count, materials);

    for (let i = 0; i < count; i += 1) {
      const radius = getBowlRadius(i, count, simulationSettings);
      const mesh = new THREE.Object3D();
      const visual = new THREE.Object3D();
      const angle = i * goldenAngle;
      const position = scatterBowlPosition(i, count, getBowlCenterLimit(radius, poolRadius));
      mesh.position.x = position.x;
      mesh.position.y = getBowlPlaneY(radius);
      mesh.position.z = position.z;
      mesh.rotation.y = angle;

      const speed = 0.095 - radius * 0.030;
      const direction = angle + Math.PI * 0.5 + (i % 3) * 0.25;
      const toneRatio = getToneRatio(radius, simulationSettings);
      bodies.push({
        id: i,
        instanceIndex: i,
        mesh,
        visual,
        resonance: {
          age: bowlResonancePulseLifetime,
          lifetime: bowlResonancePulseLifetime,
          strength: 0,
          toneRatio,
          impactDirection: new THREE.Vector2(1, 0),
          envelope: 0,
        },
        radius,
        contactRadius: getBowlContactRadius(radius),
        toneRatio,
        velocity: new THREE.Vector2(Math.cos(direction), Math.sin(direction)).multiplyScalar(speed),
        waterVelocity: new THREE.Vector2(),
        emergence: 1,
        momentumStrength: 0,
        angularVelocity: (i % 2 === 0 ? 1 : -1) * (0.035 + (i % 5) * 0.006),
        lastImpactAt: -10,
        phase: angle,
      });
    }

    scene.add(...renderer.objects);
    instances = renderer;
    return bodies;
  }

  function syncCollisionBodies(draggedBowl: BowlBody | null) {
    collisionBodies.length = bowls.length;

    for (let i = 0; i < bowls.length; i += 1) {
      const bowl = bowls[i];
      const body = collisionBodies[i] ?? {
        id: bowl.id,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        massRadius: 0,
        contactRadius: 0,
        inverseMass: 0,
      };
      body.id = bowl.id;
      body.x = bowl.mesh.position.x;
      body.z = bowl.mesh.position.z;
      body.vx = bowl.velocity.x;
      body.vz = bowl.velocity.y;
      body.massRadius = bowl.radius;
      body.contactRadius = bowl.contactRadius;
      body.inverseMass = draggedBowl === bowl || bowl.emergence < 1
        ? 0
        : 1 / Math.max(bowl.radius, 0.001);
      collisionBodies[i] = body;
    }
  }

  function emitCollisionEvent(event: BowlCollisionEvent, now: number) {
    const a = bowls[event.aId];
    const b = bowls[event.bId];
    if (!a || !b || a.emergence < 1 || b.emergence < 1) {
      return;
    }

    const contactNormal = scratchNormal.set(event.normalX, event.normalZ);
    const collisionMomentum = Math.max(event.strength * 1.25, event.closingSpeed * 3.4);
    addMomentum(a, collisionMomentum);
    addMomentum(b, collisionMomentum);

    if (now - Math.max(a.lastImpactAt, b.lastImpactAt) <= bowlImpactCooldown) {
      return;
    }

    bus.emit("ripple", {
      x: event.contactX,
      z: event.contactZ,
      strength: event.strength,
      direction: contactNormal,
    });

    if (canPlayImpactTone(event.impactMomentum)) {
      triggerBowlResonance(a, event.strength, contactNormal);
      triggerBowlResonance(b, event.strength, contactNormal.set(-event.normalX, -event.normalZ));
      bus.emit("tone", { sizeRatio: (a.toneRatio + b.toneRatio) * 0.5, strength: event.strength });
    }

    a.lastImpactAt = now;
    b.lastImpactAt = now;
  }

  const system: BowlSystem = {
    get bowls() {
      return bowls;
    },

    setFrozen(next: boolean) {
      frozen = next;
    },

    rebuild() {
      disposeInstances();
      contactStates.clear();
      bowls = createBowls();
      separate();
      instances?.update(bowls);
    },

    update(delta: number, elapsed: number, draggedBowl: BowlBody | null) {
      const poolRadius = getWaterSurfaceRadius();

      for (const bowl of bowls) {
        bowl.mesh.position.y = getBowlPlaneY(bowl.radius, bowl.emergence);
        bowl.visual.rotation.x = 0;
        bowl.visual.rotation.z = 0;

        if (frozen) {
          bowl.mesh.rotation.y += bowl.angularVelocity * delta * 0.30;
          continue;
        }

        // Surfacing bowls hold their position until they fully emerge.
        if (bowl.emergence < 1) {
          continue;
        }

        if (draggedBowl === bowl) {
          bowl.mesh.rotation.y += bowl.angularVelocity * delta * 0.30;
          continue;
        }

        bowl.momentumStrength = Math.max(0, bowl.momentumStrength - delta * bowlMomentumDecayRate);
        const momentum = bowl.momentumStrength * bowl.momentumStrength;
        const current = sampleBasinCurrent(
          { x: bowl.mesh.position.x, y: bowl.mesh.position.z },
          poolRadius,
          bowl.radius,
          elapsed,
          simulationSettings.flowShape,
          currentSample,
        );
        const baseCurrentResponse = 0.76 + bowl.toneRatio * 0.34 + current.energy * 0.30;
        const currentResponse = baseCurrentResponse * THREE.MathUtils.lerp(1, 0.28, momentum);
        const currentBlend = 1 - Math.exp(-delta * currentResponse);
        currentVelocity.set(current.x, current.y);
        bowl.velocity.lerp(currentVelocity, currentBlend);

        const wanderScale = (0.0022 + (1 - current.energy) * 0.0018) * delta;
        bowl.velocity.x += Math.cos(elapsed * 0.17 + bowl.phase) * wanderScale;
        bowl.velocity.y += Math.sin(elapsed * 0.13 - bowl.phase * 0.7) * wanderScale;

        const targetSpeed = (0.058 + current.energy * 0.046) * THREE.MathUtils.lerp(1, 3.2, momentum);
        const speedTrim = THREE.MathUtils.lerp(0.035, 0.012, momentum);
        const speed = bowl.velocity.length();
        if (speed > targetSpeed) {
          bowl.velocity.multiplyScalar(THREE.MathUtils.lerp(1, targetSpeed / speed, speedTrim));
        }

        bowl.velocity.multiplyScalar(Math.pow(0.9984, delta * 60));
        bowl.mesh.position.x += bowl.velocity.x * delta * velocityWorldScale;
        bowl.mesh.position.z += bowl.velocity.y * delta * velocityWorldScale;
        bowl.mesh.rotation.y += bowl.angularVelocity * delta;

        keepInsideBounds(bowl);
      }
    },

    resolveCollisions(now: number, draggedBowl: BowlBody | null) {
      if (frozen) {
        return;
      }

      syncCollisionBodies(draggedBowl);
      const collisionEvents = resolveBowlContacts(
        collisionBodies,
        contactStates,
        now,
        bowlCollisionSettings,
      );

      for (const body of collisionBodies) {
        const bowl = bowls[body.id];
        if (!bowl) {
          continue;
        }

        bowl.mesh.position.x = body.x;
        bowl.mesh.position.z = body.z;
        bowl.velocity.set(body.vx, body.vz);
      }

      for (const event of collisionEvents) {
        emitCollisionEvent(event, now);
      }
    },

    updateResonance(delta: number) {
      updateBowlResonance(delta, bowls);
    },

    updateInstances() {
      for (const bowl of bowls) {
        if (frozen || bowl.emergence < 1) {
          bowl.waterVelocity.set(0, 0);
        } else {
          bowl.waterVelocity.copy(bowl.velocity);
        }
      }
      instances?.update(bowls);
    },

    findAtPoint(point: THREE.Vector2) {
      let selectedBowl: BowlBody | null = null;
      let selectedDistance = Number.POSITIVE_INFINITY;

      for (const bowl of bowls) {
        if (bowl.emergence < 1) {
          continue;
        }

        const distance = Math.hypot(
          point.x - bowl.mesh.position.x,
          point.y - bowl.mesh.position.z,
        );
        const hitRadius = bowl.radius + 0.14;
        const normalizedDistance = distance / hitRadius;

        if (normalizedDistance <= 1 && normalizedDistance < selectedDistance) {
          selectedBowl = bowl;
          selectedDistance = normalizedDistance;
        }
      }

      return selectedBowl;
    },

    clampPointToBounds(bowl: BowlBody, point: THREE.Vector2) {
      const centerLimit = getBowlCenterLimit(bowl.radius, getWaterSurfaceRadius());
      if (point.length() > centerLimit) {
        point.setLength(centerLimit);
      }
      return point;
    },

    keepAllInsideBounds() {
      for (const bowl of bowls) {
        keepInsideBounds(bowl, 0);
      }
    },

    keepInsideBounds,
    addMomentum,
    separate,

    dispose() {
      disposeInstances();
      bowls = [];
      collisionBodies.length = 0;
      contactStates.clear();
    },
  };

  return system;
}
