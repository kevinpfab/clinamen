import * as THREE from "three";
import type { BowlBody } from "./types";
import {
  createInstancedBowlReflectionGeometry,
  createBowlRimGeometry,
  createInstancedBowlShellGeometry,
} from "./geometry";
import { composeBowlMatrix, composeBowlReflectionMatrix } from "./pose";
import type { BowlMaterials } from "./materials";

// The whole bowl field drawn as three instanced meshes: porcelain shells, their
// mirrored reflections, and the rim flare. Per-bowl state travels as instanced
// attributes so increasing the bowl count keeps the draw count constant.
export type BowlInstanceRenderer = {
  // Added to (and removed from) the scene by the bowl system.
  objects: THREE.Object3D[];
  update: (bowls: BowlBody[]) => void;
  dispose: () => void;
};

const bowlMatrix = new THREE.Matrix4();
function createInstancedFloatAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
  itemSize: number,
  count: number,
) {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
}

export function createBowlInstanceRenderer(
  count: number,
  materials: BowlMaterials,
): BowlInstanceRenderer {
  const capacity = Math.max(1, count);

  const shellGeometry = createInstancedBowlShellGeometry();
  const toneRatios = createInstancedFloatAttribute(shellGeometry, "aBowlToneRatio", 1, capacity);
  const pulseEnvelopes = createInstancedFloatAttribute(shellGeometry, "aBowlPulseEnvelope", 1, capacity);
  const shellImpactDirections = createInstancedFloatAttribute(shellGeometry, "aBowlImpactDirection", 2, capacity);

  const shells = new THREE.InstancedMesh(
    shellGeometry,
    materials.createInstancedPorcelain(),
    capacity,
  );
  shells.name = "Instanced porcelain bowls";
  shells.count = count;
  shells.castShadow = false;
  shells.receiveShadow = true;
  shells.frustumCulled = false;

  const reflections = new THREE.InstancedMesh(
    createInstancedBowlReflectionGeometry(),
    materials.reflection,
    capacity,
  );
  reflections.name = "Instanced bowl reflections";
  reflections.count = count;
  reflections.castShadow = false;
  reflections.receiveShadow = false;
  reflections.frustumCulled = false;
  reflections.renderOrder = 0;

  const rimGeometry = createBowlRimGeometry();
  const rimPulses = createInstancedFloatAttribute(rimGeometry, "aRimPulse", 4, capacity);
  const rimImpactDirections = createInstancedFloatAttribute(rimGeometry, "aRimImpactDirection", 2, capacity);

  const rims = new THREE.InstancedMesh(rimGeometry, materials.createResonance(), capacity);
  rims.name = "Instanced bowl impulse rims";
  rims.count = count;
  rims.frustumCulled = false;
  rims.renderOrder = 7;

  return {
    objects: [reflections, shells, rims],

    update(bowls: BowlBody[]) {
      shells.count = bowls.length;
      reflections.count = bowls.length;
      let rimCount = 0;

      for (const bowl of bowls) {
        const index = bowl.instanceIndex;
        const resonance = bowl.resonance;

        composeBowlMatrix(bowl, bowlMatrix);
        shells.setMatrixAt(index, bowlMatrix);
        // Compact active flares so inactive bowls incur no rim geometry or
        // fragment work, even though the band now follows the real porcelain.
        if (!bowl.rimFlareSuppressed && resonance.strength > 0.001 && resonance.age < resonance.lifetime) {
          rims.setMatrixAt(rimCount, bowlMatrix);
          rimPulses.setXYZW(rimCount, resonance.age, resonance.lifetime, resonance.strength, resonance.toneRatio);
          rimImpactDirections.setXY(rimCount, resonance.impactDirection.x, resonance.impactDirection.y);
          rimCount += 1;
        }
        composeBowlReflectionMatrix(bowl, bowlMatrix);
        reflections.setMatrixAt(index, bowlMatrix);

        toneRatios.setX(index, bowl.toneRatio);
        pulseEnvelopes.setX(index, resonance.envelope);
        shellImpactDirections.setXY(
          index,
          resonance.impactDirection.x,
          resonance.impactDirection.y,
        );

      }

      rims.count = rimCount;
      shells.instanceMatrix.needsUpdate = true;
      reflections.instanceMatrix.needsUpdate = true;
      rims.instanceMatrix.needsUpdate = true;
      toneRatios.needsUpdate = true;
      pulseEnvelopes.needsUpdate = true;
      shellImpactDirections.needsUpdate = true;
      rimPulses.needsUpdate = true;
      rimImpactDirections.needsUpdate = true;
    },

    dispose() {
      // The reflection material is owned by BowlMaterials and shared, so it is
      // not disposed here.
      shells.geometry.dispose();
      shells.material.dispose();
      reflections.geometry.dispose();
      rims.geometry.dispose();
      rims.material.dispose();
    },
  };
}
