import * as THREE from "three";
import {
  bowlCollisionSettings,
  bowlEmergenceDepth,
  bowlImpactCooldown,
  debugSettings,
  simulationSettings,
  velocityWorldScale,
} from "../config";
import { EventBus, type BasinEvents } from "../core/events";
import { pseudoRandom } from "../core/math";
import { scene } from "../core/stage";
import { getWaterSurfaceRadius } from "../core/world";
import {
  getBowlContactRadius,
  resolveBowlContacts,
  type BowlCollisionBody,
  type BowlCollisionEvent,
  type BowlContactState,
} from "../physics/collision";
import { resolveCircularBoundaryContact } from "../physics/bounds";
import { sampleBasinCurrent, type BasinCurrentSample } from "../physics/flow";
import type { BowlBody } from "./types";
import { createBowlInstanceRenderer, type BowlInstanceRenderer } from "./instances";
import { bowlResonancePulseLifetime } from "./materials";
import { triggerBowlResonance, updateBowlResonance } from "./resonance";
import {
  getBowlCenterLimit,
  getBowlPlaneY,
  getBowlRadius,
  getToneRatio,
} from "./tuning";

const bowlMomentumDecayRate = 0.38;
const maxBowlMomentumStrength = 1;

export class BowlSystem {
  private bowlsInternal: BowlBody[] = [];
  // While frozen (the intro, until every bowl has surfaced) bowls only spin
  // in place: no drift, no collisions. The simulation then starts as one
  // moment instead of bowl by bowl.
  private frozen = false;
  private bowlInstances: BowlInstanceRenderer | null = null;
  private readonly contactStates = new Map<number, BowlContactState>();
  private readonly collisionBodies: BowlCollisionBody[] = [];
  private readonly currentSample: BasinCurrentSample = {
    x: 0,
    y: 0,
    energy: 0,
    centerChannel: 0,
    rimChannel: 0,
  };
  private readonly currentVelocity = new THREE.Vector2();

  constructor(private readonly bus: EventBus<BasinEvents>) {}

  get bowls() {
    return this.bowlsInternal;
  }

  setFrozen(frozen: boolean) {
    this.frozen = frozen;
  }

  rebuild() {
    this.disposeInstances();
    this.contactStates.clear();
    this.bowlsInternal = this.createBowls();
  }

  dispose() {
    this.disposeInstances();
    this.bowlsInternal = [];
    this.collisionBodies.length = 0;
    this.contactStates.clear();
  }

  update(delta: number, elapsed: number, draggedBowl: BowlBody | null) {
    const poolRadius = getWaterSurfaceRadius();

    for (const bowl of this.bowlsInternal) {
      bowl.mesh.position.y = getBowlPlaneY(bowl.radius)
        - bowlEmergenceDepth * (1 - bowl.emergence);
      bowl.visual.rotation.x = 0;
      bowl.visual.rotation.z = 0;

      if (this.frozen) {
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
        this.currentSample,
      );
      const baseCurrentResponse = 0.76 + bowl.toneRatio * 0.34 + current.energy * 0.30;
      const currentResponse = baseCurrentResponse * THREE.MathUtils.lerp(1, 0.28, momentum);
      const currentBlend = 1 - Math.exp(-delta * currentResponse);
      this.currentVelocity.set(current.x, current.y);
      bowl.velocity.lerp(this.currentVelocity, currentBlend);

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

      this.keepInsideBounds(bowl);
    }
  }

  resolveCollisions(now: number, draggedBowl: BowlBody | null) {
    if (this.frozen) {
      return;
    }

    this.syncCollisionBodies(draggedBowl);
    const collisionEvents = resolveBowlContacts(
      this.collisionBodies,
      this.contactStates,
      now,
      bowlCollisionSettings,
    );

    for (const body of this.collisionBodies) {
      const bowl = this.bowlsInternal[body.id];
      if (!bowl) {
        continue;
      }

      bowl.mesh.position.x = body.x;
      bowl.mesh.position.z = body.z;
      bowl.velocity.set(body.vx, body.vz);
    }

    for (const event of collisionEvents) {
      this.emitCollisionEvent(event, now);
    }
  }

  updateResonance(delta: number) {
    updateBowlResonance(delta, this.bowlsInternal);
  }

  updateInstances() {
    this.bowlInstances?.update(this.bowlsInternal);
  }

  findAtPoint(point: THREE.Vector2) {
    let selectedBowl: BowlBody | null = null;
    let selectedDistance = Number.POSITIVE_INFINITY;

    for (const bowl of this.bowlsInternal) {
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
  }

  clampPointToBounds(bowl: BowlBody, point: THREE.Vector2) {
    const centerLimit = getBowlCenterLimit(bowl.radius);
    if (point.length() > centerLimit) {
      point.setLength(centerLimit);
    }
    return point;
  }

  keepAllInsideBounds() {
    for (const bowl of this.bowlsInternal) {
      this.keepInsideBounds(bowl, 0);
    }
  }

  keepInsideBounds(bowl: BowlBody, restitution = 0.76) {
    const contact = resolveCircularBoundaryContact({
      x: bowl.mesh.position.x,
      z: bowl.mesh.position.z,
      vx: bowl.velocity.x,
      vz: bowl.velocity.y,
      radius: bowl.radius,
      centerLimit: getBowlCenterLimit(bowl.radius),
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

    this.addMomentum(bowl, contact.impactStrength * 2.6);
    const inwardDirection = new THREE.Vector2(-contact.normalX, -contact.normalZ);
    this.bus.emit("ripple", {
      x: contact.normalX * getWaterSurfaceRadius(),
      z: contact.normalZ * getWaterSurfaceRadius(),
      strength: THREE.MathUtils.clamp(
        0.18 + Math.sqrt(Math.max(0, contact.impactStrength)) * 0.18,
        0.18,
        0.42,
      ),
      direction: inwardDirection,
    });
    if (this.canPlayImpactTone(contact.impactMomentum)) {
      const normal = new THREE.Vector2(contact.normalX, contact.normalZ);
      triggerBowlResonance(bowl, contact.impactStrength * 1.8, normal);
      this.bus.emit("tone", { sizeRatio: bowl.toneRatio, strength: contact.impactStrength });
    }
  }

  addMomentum(bowl: BowlBody, strength: number) {
    bowl.momentumStrength = Math.max(
      bowl.momentumStrength,
      THREE.MathUtils.clamp(strength, 0, maxBowlMomentumStrength),
    );
  }

  private createBowls(): BowlBody[] {
    const bodies: BowlBody[] = [];
    const instances = createBowlInstanceRenderer(simulationSettings.bowlCount);

    for (let i = 0; i < simulationSettings.bowlCount; i += 1) {
      const radius = getBowlRadius(i, simulationSettings.bowlCount);
      const contactRadius = getBowlContactRadius(radius);
      const mesh = new THREE.Object3D();
      const visual = new THREE.Object3D();
      const angle = i * 2.399963229728653;
      const position = this.findInitialPosition(radius, bodies, i);
      mesh.position.x = position.x;
      mesh.position.y = getBowlPlaneY(radius);
      mesh.position.z = position.y;
      mesh.rotation.y = angle;

      const speed = 0.095 - radius * 0.030;
      const direction = angle + Math.PI * 0.5 + (i % 3) * 0.25;
      bodies.push({
        id: i,
        instanceIndex: i,
        mesh,
        visual,
        resonance: {
          age: bowlResonancePulseLifetime,
          lifetime: bowlResonancePulseLifetime,
          strength: 0,
          toneRatio: getToneRatio(radius),
          impactDirection: new THREE.Vector2(1, 0),
          envelope: 0,
        },
        radius,
        contactRadius,
        toneRatio: getToneRatio(radius),
        velocity: new THREE.Vector2(Math.cos(direction), Math.sin(direction)).multiplyScalar(speed),
        emergence: 1,
        momentumStrength: 0,
        angularVelocity: (i % 2 === 0 ? 1 : -1) * (0.035 + (i % 5) * 0.006),
        lastImpactAt: -10,
        phase: angle,
      });
    }

    scene.add(...instances.objects);
    instances.update(bodies);
    this.bowlInstances = instances;
    return bodies;
  }

  private findInitialPosition(radius: number, existingBodies: BowlBody[], index: number) {
    const centerLimit = getBowlCenterLimit(radius);
    const contactRadius = getBowlContactRadius(radius);

    for (let attempt = 0; attempt < 180; attempt += 1) {
      const angle = pseudoRandom(index * 71.3 + attempt * 13.7 + 0.19) * Math.PI * 2;
      const distance = Math.sqrt(pseudoRandom(index * 43.1 + attempt * 19.9 + 0.53)) * centerLimit;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const fits = existingBodies.every((body) => {
        const dx = body.mesh.position.x - x;
        const dz = body.mesh.position.z - z;
        return Math.hypot(dx, dz) > body.contactRadius + contactRadius + 0.06;
      });

      if (fits) {
        return new THREE.Vector2(x, z);
      }
    }

    const fallbackAngle = index * 2.399963229728653;
    const fallbackRing = 0.22 + (index % 5) * 0.12;
    return new THREE.Vector2(
      Math.cos(fallbackAngle) * centerLimit * fallbackRing,
      Math.sin(fallbackAngle) * centerLimit * fallbackRing,
    );
  }

  private disposeInstances() {
    if (!this.bowlInstances) {
      return;
    }

    scene.remove(...this.bowlInstances.objects);
    this.bowlInstances.dispose();
    this.bowlInstances = null;
  }

  private syncCollisionBodies(draggedBowl: BowlBody | null) {
    this.collisionBodies.length = this.bowlsInternal.length;

    for (let i = 0; i < this.bowlsInternal.length; i += 1) {
      const bowl = this.bowlsInternal[i];
      const body = this.collisionBodies[i] ?? {
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
      this.collisionBodies[i] = body;
    }
  }

  private emitCollisionEvent(event: BowlCollisionEvent, now: number) {
    const a = this.bowlsInternal[event.aId];
    const b = this.bowlsInternal[event.bId];
    if (!a || !b || a.emergence < 1 || b.emergence < 1) {
      return;
    }

    const contactNormal = new THREE.Vector2(event.normalX, event.normalZ);
    const collisionMomentum = Math.max(event.strength * 1.25, event.closingSpeed * 3.4);
    this.addMomentum(a, collisionMomentum);
    this.addMomentum(b, collisionMomentum);

    if (now - Math.max(a.lastImpactAt, b.lastImpactAt) <= bowlImpactCooldown) {
      return;
    }

    this.bus.emit("ripple", {
      x: event.contactX,
      z: event.contactZ,
      strength: event.strength,
      direction: contactNormal,
    });

    if (this.canPlayImpactTone(event.impactMomentum)) {
      triggerBowlResonance(a, event.strength, contactNormal);
      triggerBowlResonance(b, event.strength, contactNormal.clone().multiplyScalar(-1));
      this.bus.emit("tone", { sizeRatio: (a.toneRatio + b.toneRatio) * 0.5, strength: event.strength });
    }

    a.lastImpactAt = now;
    b.lastImpactAt = now;
  }

  private canPlayImpactTone(impactMomentum: number) {
    return impactMomentum >= debugSettings.impactMomentumFloor;
  }
}

export function createBowlSystem(bus: EventBus<BasinEvents>) {
  const system = new BowlSystem(bus);
  system.rebuild();
  return system;
}
