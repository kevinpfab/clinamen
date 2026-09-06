import * as THREE from "three";
import { waterPlaneY } from "../config";
import type { BowlBody } from "./types";
import {
  createInstancedBowlReflectionGeometry,
  createInstancedBowlRimGeometry,
  createInstancedBowlShellGeometry,
} from "./geometry";
import { getBowlRimY } from "./profile";
import type { BowlMaterials } from "./materials";

// The whole bowl field drawn as three instanced meshes: porcelain shells, their
// mirrored reflections, and the rim flare. Per-bowl state travels as instanced
// attributes so the count of bowls costs draw calls, not draws.
export type BowlInstanceRenderer = {
  // Added to (and removed from) the scene by the bowl system.
  objects: THREE.Object3D[];
  update: (bowls: BowlBody[]) => void;
  dispose: () => void;
};

const bowlMatrix = new THREE.Matrix4();
const bowlPosition = new THREE.Vector3();
const bowlScale = new THREE.Vector3();
const bowlRotation = new THREE.Euler();
const bowlQuaternion = new THREE.Quaternion();

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

function setBowlMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  bowl: BowlBody,
  y: number,
  scale = 1,
) {
  bowlPosition.set(bowl.mesh.position.x, y, bowl.mesh.position.z);
  bowlRotation.set(bowl.visual.rotation.x, bowl.mesh.rotation.y, bowl.visual.rotation.z);
  bowlQuaternion.setFromEuler(bowlRotation);
  bowlScale.setScalar(bowl.radius * Math.max(scale, 0.0001));
  bowlMatrix.compose(bowlPosition, bowlQuaternion, bowlScale);
  mesh.setMatrixAt(index, bowlMatrix);
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

  const rimGeometry = createInstancedBowlRimGeometry();
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
      rims.count = bowls.length;

      for (const bowl of bowls) {
        const index = bowl.instanceIndex;
        const resonance = bowl.resonance;

        setBowlMatrix(shells, index, bowl, bowl.mesh.position.y);
        // A submerged bowl has no mirror image; grow the reflection back in as
        // the bowl breaks the surface.
        setBowlMatrix(
          reflections,
          index,
          bowl,
          waterPlaneY * 2 - bowl.mesh.position.y,
          THREE.MathUtils.smoothstep(bowl.emergence, 0.82, 1),
        );
        setBowlMatrix(rims, index, bowl, bowl.mesh.position.y + getBowlRimY(bowl.radius));

        toneRatios.setX(index, bowl.toneRatio);
        pulseEnvelopes.setX(index, resonance.envelope);
        shellImpactDirections.setXY(
          index,
          resonance.impactDirection.x,
          resonance.impactDirection.y,
        );
        // The intro renders the hero's rim flare with a dedicated high-res mesh;
        // zero this bowl's instanced strength so the two don't stack.
        rimPulses.setXYZW(
          index,
          resonance.age,
          resonance.lifetime,
          bowl.rimFlareSuppressed ? 0 : resonance.strength,
          resonance.toneRatio,
        );
        rimImpactDirections.setXY(
          index,
          resonance.impactDirection.x,
          resonance.impactDirection.y,
        );
      }

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
