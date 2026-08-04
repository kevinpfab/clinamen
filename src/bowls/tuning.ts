import * as THREE from "three";
import {
  bowlHeightScale,
  bowlShellBottomHeightScale,
  waterPlaneY,
} from "../config";
import type { BowlSizeRange } from "../settings";

// Pure mappings from a bowl index/radius to its physical height, resting plane,
// drift bounds, and microtonal tone ratio. Everything varying is a parameter:
// these used to read simulationSettings and getWaterSurfaceRadius() directly,
// which made them depend on global mutable state and impossible to test.

export function getBowlHeight(radius: number) {
  return radius * bowlHeightScale;
}

export function getBowlPlaneY(radius: number) {
  return waterPlaneY - getBowlHeight(radius) * bowlShellBottomHeightScale;
}

// Bowl radii are spread over the size range by a golden-ratio sequence, so any
// prefix of the bowls covers the range evenly rather than in index order.
export function getBowlRadius(index: number, count: number, sizeRange: BowlSizeRange) {
  if (count <= 1) {
    return (sizeRange.minRadius + sizeRange.maxRadius) * 0.5;
  }

  const distributed = (index * 0.618033988749895) % 1;
  const softened = THREE.MathUtils.smoothstep(distributed, 0, 1);
  return THREE.MathUtils.lerp(sizeRange.minRadius, sizeRange.maxRadius, softened);
}

// 1 for the smallest bowl (highest tone), 0 for the largest.
export function getToneRatio(radius: number, sizeRange: BowlSizeRange) {
  const sizeSpan = Math.max(0.001, sizeRange.maxRadius - sizeRange.minRadius);
  return THREE.MathUtils.clamp(1 - (radius - sizeRange.minRadius) / sizeSpan, 0, 1);
}

// How far a bowl's center may travel from the pool center before its rim
// reaches the basin wall.
export function getBowlCenterLimit(radius: number, poolRadius: number) {
  return Math.max(0.2, poolRadius - radius);
}
