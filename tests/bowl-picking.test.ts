import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createBowlSystem, type BowlSystem } from "../src/bowls/system";
import { createBowlMaterials, type BowlMaterials } from "../src/bowls/materials";
import { createWaterUniforms } from "../src/water/uniforms";
import { EventBus, type BasinEvents } from "../src/core/events";
import { simulationSettings } from "../src/settings";

const originalSettings = { ...simulationSettings };
let system: BowlSystem | null = null;
let materials: BowlMaterials | null = null;

function fixture(count = 1) {
  simulationSettings.bowlCount = count;
  simulationSettings.minRadius = 0.5;
  simulationSettings.maxRadius = 0.5;
  materials = createBowlMaterials(createWaterUniforms());
  system = createBowlSystem({ bus: new EventBus<BasinEvents>(), scene: new THREE.Scene(), materials, currentEnabled: false });
  system.rebuild();
  for (const bowl of system.bowls) {
    bowl.mesh.position.x = 0;
    bowl.mesh.position.z = 0;
  }
  system.updateInstances();
  return system;
}

function rayTo(origin: THREE.Vector3, target: THREE.Vector3) {
  return new THREE.Raycaster(origin, target.clone().sub(origin).normalize());
}

afterEach(() => {
  system?.dispose();
  materials?.dispose();
  system = null;
  materials = null;
  Object.assign(simulationSettings, originalSettings);
});

describe("rendered bowl picking", () => {
  test("a shallow ray selects the visible upper shell even when its water-plane hit misses", () => {
    const bowls = fixture();
    const ray = rayTo(new THREE.Vector3(0, 0.65, 5), new THREE.Vector3(0, 0.26, 0.49));
    const waterPoint = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    expect(waterPoint).not.toBeNull();
    expect(bowls.findAtPoint(new THREE.Vector2(waterPoint!.x, waterPoint!.z))).toBeNull();
    expect(bowls.pick(ray)).toBe(bowls.bowls[0]);
  });

  test("picking refreshes aggregate bounds after a bowl moves beyond its old sphere", () => {
    const bowls = fixture();
    expect(bowls.pick(new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0)))).toBe(bowls.bowls[0]);
    bowls.bowls[0].mesh.position.x = 4;
    bowls.updateInstances();
    expect(bowls.pick(new THREE.Raycaster(new THREE.Vector3(4, 2, 0), new THREE.Vector3(0, -1, 0)))).toBe(bowls.bowls[0]);
    expect(bowls.pick(new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0)))).toBeNull();
  });

  test("the nearest shell wins rather than array order or a reflection", () => {
    const bowls = fixture(2);
    bowls.bowls[0].mesh.position.z = -1;
    bowls.bowls[1].mesh.position.z = 1;
    bowls.updateInstances();
    expect(bowls.pick(new THREE.Raycaster(new THREE.Vector3(0, 0.15, 5), new THREE.Vector3(0, 0, -1)))).toBe(bowls.bowls[1]);
    // Mirror silhouettes below the hull must not become selectable geometry.
    expect(bowls.pick(new THREE.Raycaster(new THREE.Vector3(0, -0.2, 5), new THREE.Vector3(0, 0, -1)))).toBeNull();
  });

  test("submerged bowls are not eligible for interaction", () => {
    const bowls = fixture();
    bowls.bowls[0].emergence = 0.9;
    expect(bowls.pick(new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0)))).toBeNull();
  });
});
