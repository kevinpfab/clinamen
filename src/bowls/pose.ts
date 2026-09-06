import * as THREE from "three";
import { waterPlaneY } from "../config";
import type { BowlBody } from "./types";

type BowlPose = Pick<BowlBody, "mesh" | "visual" | "radius">;
const rotation = new THREE.Euler();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const mirror = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, -1, 0, waterPlaneY * 2,
  0, 0, 1, 0,
  0, 0, 0, 1,
);
const mirroredGeometryScale = new THREE.Vector3(1, -1, 1);

// All visible bowl parts are authored in bowl-local coordinates. A single
// transform keeps the shell, lip and intro shudder aligned at every size.
export function composeBowlMatrix(bowl: BowlPose, target: THREE.Matrix4) {
  rotation.set(bowl.visual.rotation.x, bowl.mesh.rotation.y, bowl.visual.rotation.z);
  quaternion.setFromEuler(rotation);
  scale.setScalar(bowl.radius);
  return target.compose(bowl.mesh.position, quaternion, scale);
}

export function composeBowlReflectionMatrix(bowl: BowlPose, target: THREE.Matrix4) {
  composeBowlMatrix(bowl, target);
  // Reflection geometry is already inverted locally. Cancel that inversion
  // before mirroring the completed pose in world space. The resulting instance
  // matrix has positive determinant, as required by InstancedMesh.
  return target.premultiply(mirror).scale(mirroredGeometryScale);
}
