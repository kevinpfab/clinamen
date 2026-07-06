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

  // The rim lip is a shallow arc bridging the outer and inner walls so the
  // profile never pinches into a knife edge at the top.
  const rimOuterX = radius * 0.985;
  const rimInnerX = radius * 0.940;
  const rimCenterX = (rimOuterX + rimInnerX) / 2;
  const rimHalfWidth = (rimOuterX - rimInnerX) / 2;
  const rimLip = (t: number) => {
    const angle = t * Math.PI;
    return new THREE.Vector2(
      rimCenterX + Math.cos(angle) * rimHalfWidth,
      height + Math.sin(angle) * rimRoundness,
    );
  };

  const outer = [
    new THREE.Vector2(0, height * 0.050),
    new THREE.Vector2(radius * 0.54, height * 0.035),
    new THREE.Vector2(radius * wallRadius(0.76, 0.88), height * 0.080),
    new THREE.Vector2(radius * 0.998, height * 0.880),
    rimLip(0),
    rimLip(0.25),
    rimLip(0.5),
  ];
  const inner = [
    rimLip(0.75),
    rimLip(1),
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
