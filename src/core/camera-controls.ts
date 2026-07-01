import * as THREE from "three";
import { camera, cameraTarget } from "./stage";
import { isMobilePerformanceTarget } from "../config";
import type { CameraOrbitState } from "../input/types";

// Orbit camera state and the math that frames the pool responsively. Pointer and
// pinch handlers mutate cameraOrbit and call applyCameraOrbit to recompute the view.
export const cameraOrbit: CameraOrbitState = {
  azimuth: 0,
  pitch: 0.60,
  distance: 17.4,
  minDistance: 7,
  maxDistance: 36,
  minPitch: 0.12,
  maxPitch: 1.46,
  hasUserControl: false,
};

export function getResponsiveCameraDefaults(aspect: number) {
  const isPortrait = aspect < 1;
  const useMobileOverview = isMobilePerformanceTarget || isPortrait;

  if (useMobileOverview) {
    return {
      fov: 54,
      azimuth: 0,
      pitch: 1.38,
      distance: 20.2,
    };
  }

  const height = 9.8;
  const depth = 14.4;
  return {
    fov: 48,
    azimuth: 0,
    pitch: Math.atan2(height, depth),
    distance: Math.hypot(height, depth),
  };
}

export function getPoolFitDistance(radius: number, fovDeg: number, aspect: number) {
  // Treat the pool as a bounding sphere of `radius` and back the camera off far
  // enough that it sits inside the frustum on the narrower axis (width in
  // portrait). Keeps the whole basin on screen without page scrolling.
  const halfVertical = THREE.MathUtils.degToRad(fovDeg) / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const halfAngle = Math.min(halfVertical, halfHorizontal);
  const margin = 1.1;
  return (radius * margin) / Math.sin(halfAngle);
}

export function applyCameraOrbit() {
  const horizontalDistance = Math.cos(cameraOrbit.pitch) * cameraOrbit.distance;
  camera.position.set(
    cameraTarget.x + Math.sin(cameraOrbit.azimuth) * horizontalDistance,
    cameraTarget.y + Math.sin(cameraOrbit.pitch) * cameraOrbit.distance,
    cameraTarget.z + Math.cos(cameraOrbit.azimuth) * horizontalDistance,
  );
  camera.lookAt(cameraTarget);
  camera.updateMatrixWorld();
}
