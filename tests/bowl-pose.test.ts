import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { waterPlaneY } from "../src/config";
import { composeBowlMatrix, composeBowlReflectionMatrix } from "../src/bowls/pose";
import { createBowlRimGeometry, createInstancedBowlShellGeometry } from "../src/bowls/geometry";

describe("shared bowl pose", () => {
  test("reflection mirrors the final tilted, translated pose without shrinking", () => {
    const bowl = { mesh: new THREE.Object3D(), visual: new THREE.Object3D(), radius: 0.5 };
    bowl.mesh.position.set(2, -0.13, -1);
    bowl.mesh.rotation.y = 1.2;
    bowl.visual.rotation.set(0.05, 0, -0.03);
    const shell = composeBowlMatrix(bowl, new THREE.Matrix4());
    const reflection = composeBowlReflectionMatrix(bowl, new THREE.Matrix4());
    expect(reflection.determinant()).toBeGreaterThan(0);
    for (const local of [new THREE.Vector3(0.9, 0.6, 0.1), new THREE.Vector3(0.5, 0.02, -0.2)]) {
      const actual = local.clone().multiply(new THREE.Vector3(1, -1, 1)).applyMatrix4(reflection);
      const expected = local.clone().applyMatrix4(shell);
      expected.y = waterPlaneY * 2 - expected.y;
      expect(actual.distanceTo(expected)).toBeLessThan(1e-12);
    }
  });

  test("rim geometry remains attached to the crown under the shared transform", () => {
    const shell = createInstancedBowlShellGeometry();
    const rim = createBowlRimGeometry();
    shell.computeBoundingBox();
    rim.computeBoundingBox();
    // The band sits only a small surface-normal offset outside the actual lip,
    // and uses the same origin so rotation cannot introduce an extra offset.
    const crownOffset = rim.boundingBox!.max.y - shell.boundingBox!.max.y;
    expect(crownOffset).toBeGreaterThan(0);
    expect(crownOffset).toBeLessThan(0.003);
    expect(rim.boundingBox!.min.y).toBeLessThan(shell.boundingBox!.max.y);
    shell.dispose();
    rim.dispose();
  });
});
