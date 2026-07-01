import * as THREE from "three";
import { bowlImpactRimInnerRadius, bowlLatheSegments, bowlWallStraightness } from "../config";
import type { BowlShellProfile } from "./types";
import { getBowlHeight } from "./tuning";

// Shared bowl profiles. The render path instances these unit-radius geometries
// and applies per-bowl transforms instead of allocating geometry per bowl.
export function getBowlRimRoundness(radius: number) {
  return Math.max(0.018, radius * 0.030);
}

export function getBowlRimY(radius: number) {
  return getBowlHeight(radius) + getBowlRimRoundness(radius);
}

export function createBowlShellProfile(radius: number): BowlShellProfile {
  const height = getBowlHeight(radius);
  const rimRoundness = getBowlRimRoundness(radius);
  const wallRadius = (current: number, straighter: number) =>
    THREE.MathUtils.lerp(current, straighter, bowlWallStraightness);

  const outer = [
    new THREE.Vector2(0, height * 0.050),
    new THREE.Vector2(radius * 0.54, height * 0.035),
    new THREE.Vector2(radius * wallRadius(0.76, 0.88), height * 0.080),
    new THREE.Vector2(radius * 0.998, height * 0.880),
    new THREE.Vector2(radius * 0.975, height + rimRoundness),
  ];
  const inner = [
    new THREE.Vector2(radius * 0.940, height * 0.955),
    new THREE.Vector2(radius * wallRadius(0.690, 0.800), height * 0.420),
    new THREE.Vector2(radius * 0.220, height * 0.082),
    new THREE.Vector2(0, height * 0.075),
  ];

  return {
    full: [...outer, ...inner],
    outer,
    rimY: height + rimRoundness,
  };
}

export function createInstancedBowlShellGeometry() {
  return new THREE.LatheGeometry(createBowlShellProfile(1).full, bowlLatheSegments);
}

export function createInstancedBowlReflectionGeometry() {
  const geometry = new THREE.LatheGeometry(createBowlShellProfile(1).outer, bowlLatheSegments);
  geometry.scale(1, -1, 1);
  return geometry;
}

export function createInstancedBowlRimGeometry() {
  const geometry = new THREE.RingGeometry(bowlImpactRimInnerRadius, 1.0, bowlLatheSegments, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
