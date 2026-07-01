import * as THREE from "three";
import {
  bowlHeightScale,
  bowlShellBottomHeightScale,
  simulationSettings,
  waterPlaneY,
} from "../config";
import { getWaterSurfaceRadius } from "../core/world";

// Pure mappings from a bowl index/radius to its physical height, resting plane,
// drift bounds, and microtonal tone ratio.
export function getBowlHeight(radius: number) {
  return radius * bowlHeightScale;
}

export function getBowlPlaneY(radius: number) {
  return waterPlaneY - getBowlHeight(radius) * bowlShellBottomHeightScale;
}


export function getBowlRadius(index: number, count: number) {
  if (count <= 1) {
    return (simulationSettings.minRadius + simulationSettings.maxRadius) * 0.5;
  }

  const distributed = (index * 0.618033988749895) % 1;
  const softened = THREE.MathUtils.smoothstep(distributed, 0, 1);
  return THREE.MathUtils.lerp(simulationSettings.minRadius, simulationSettings.maxRadius, softened);
}

export function getToneRatio(radius: number) {
  const sizeSpan = Math.max(0.001, simulationSettings.maxRadius - simulationSettings.minRadius);
  return THREE.MathUtils.clamp(1 - (radius - simulationSettings.minRadius) / sizeSpan, 0, 1);
}

export function getBowlCenterLimit(radius: number) {
  return Math.max(0.2, getWaterSurfaceRadius() - radius);
}

