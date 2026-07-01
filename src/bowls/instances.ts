import * as THREE from "three";
import { waterPlaneY } from "../config";
import type { BowlBody } from "./types";
import {
  createInstancedBowlReflectionGeometry,
  createInstancedBowlRimGeometry,
  createInstancedBowlShellGeometry,
  getBowlRimY,
} from "./geometry";
import {
  createBowlResonanceMaterial,
  createInstancedPorcelainMaterial,
  reflectionMaterial,
} from "./materials";

type InstancedFloatAttribute = THREE.InstancedBufferAttribute;

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
) {
  bowlPosition.set(bowl.mesh.position.x, y, bowl.mesh.position.z);
  bowlRotation.set(bowl.visual.rotation.x, bowl.mesh.rotation.y, bowl.visual.rotation.z);
  bowlQuaternion.setFromEuler(bowlRotation);
  bowlScale.setScalar(bowl.radius);
  bowlMatrix.compose(bowlPosition, bowlQuaternion, bowlScale);
  mesh.setMatrixAt(index, bowlMatrix);
}

export class BowlInstanceRenderer {
  readonly shells: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  readonly reflections: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly rims: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  readonly objects: THREE.Object3D[];

  private readonly toneRatios: InstancedFloatAttribute;
  private readonly pulseEnvelopes: InstancedFloatAttribute;
  private readonly shellImpactDirections: InstancedFloatAttribute;
  private readonly rimPulses: InstancedFloatAttribute;
  private readonly rimImpactDirections: InstancedFloatAttribute;

  constructor(count: number) {
    const capacity = Math.max(1, count);
    const shellGeometry = createInstancedBowlShellGeometry();
    this.toneRatios = createInstancedFloatAttribute(shellGeometry, "aBowlToneRatio", 1, capacity);
    this.pulseEnvelopes = createInstancedFloatAttribute(shellGeometry, "aBowlPulseEnvelope", 1, capacity);
    this.shellImpactDirections = createInstancedFloatAttribute(shellGeometry, "aBowlImpactDirection", 2, capacity);

    this.shells = new THREE.InstancedMesh(
      shellGeometry,
      createInstancedPorcelainMaterial(),
      capacity,
    );
    this.shells.name = "Instanced porcelain bowls";
    this.shells.count = count;
    this.shells.castShadow = false;
    this.shells.receiveShadow = true;
    this.shells.frustumCulled = false;

    this.reflections = new THREE.InstancedMesh(
      createInstancedBowlReflectionGeometry(),
      reflectionMaterial,
      capacity,
    );
    this.reflections.name = "Instanced bowl reflections";
    this.reflections.count = count;
    this.reflections.castShadow = false;
    this.reflections.receiveShadow = false;
    this.reflections.frustumCulled = false;
    this.reflections.renderOrder = 0;

    const rimGeometry = createInstancedBowlRimGeometry();
    this.rimPulses = createInstancedFloatAttribute(rimGeometry, "aRimPulse", 4, capacity);
    this.rimImpactDirections = createInstancedFloatAttribute(rimGeometry, "aRimImpactDirection", 2, capacity);

    this.rims = new THREE.InstancedMesh(
      rimGeometry,
      createBowlResonanceMaterial(),
      capacity,
    );
    this.rims.name = "Instanced bowl impulse rims";
    this.rims.count = count;
    this.rims.frustumCulled = false;
    this.rims.renderOrder = 7;

    this.objects = [this.reflections, this.shells, this.rims];
  }

  update(bowls: BowlBody[]) {
    this.shells.count = bowls.length;
    this.reflections.count = bowls.length;
    this.rims.count = bowls.length;

    for (const bowl of bowls) {
      const index = bowl.instanceIndex;
      const resonance = bowl.resonance;

      setBowlMatrix(this.shells, index, bowl, bowl.mesh.position.y);
      setBowlMatrix(this.reflections, index, bowl, waterPlaneY * 2 - bowl.mesh.position.y);
      setBowlMatrix(this.rims, index, bowl, bowl.mesh.position.y + getBowlRimY(bowl.radius));

      this.toneRatios.setX(index, bowl.toneRatio);
      this.pulseEnvelopes.setX(index, resonance.envelope);
      this.shellImpactDirections.setXY(
        index,
        resonance.impactDirection.x,
        resonance.impactDirection.y,
      );
      this.rimPulses.setXYZW(
        index,
        resonance.age,
        resonance.lifetime,
        resonance.strength,
        resonance.toneRatio,
      );
      this.rimImpactDirections.setXY(
        index,
        resonance.impactDirection.x,
        resonance.impactDirection.y,
      );
    }

    this.shells.instanceMatrix.needsUpdate = true;
    this.reflections.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
    this.toneRatios.needsUpdate = true;
    this.pulseEnvelopes.needsUpdate = true;
    this.shellImpactDirections.needsUpdate = true;
    this.rimPulses.needsUpdate = true;
    this.rimImpactDirections.needsUpdate = true;
  }

  dispose() {
    this.shells.geometry.dispose();
    this.shells.material.dispose();
    this.reflections.geometry.dispose();
    this.rims.geometry.dispose();
    this.rims.material.dispose();
  }
}

export function createBowlInstanceRenderer(count: number) {
  return new BowlInstanceRenderer(count);
}
