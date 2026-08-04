import * as THREE from "three";
import { isMobilePerformanceTarget } from "../config";
import type { CameraOrbitState } from "../input/types";

// Orbit camera state and the math that frames the pool responsively. Pointer
// and pinch handlers mutate `orbit` and call `apply()` to recompute the view.
export type CameraControls = {
  orbit: CameraOrbitState;
  apply: () => void;
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

export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
): CameraControls {
  const orbit: CameraOrbitState = {
    azimuth: 0,
    pitch: 0.60,
    distance: 17.4,
    minDistance: 7,
    maxDistance: 36,
    minPitch: 0.12,
    maxPitch: 1.46,
    hasUserControl: false,
  };

  return {
    orbit,
    apply() {
      const horizontalDistance = Math.cos(orbit.pitch) * orbit.distance;
      camera.position.set(
        target.x + Math.sin(orbit.azimuth) * horizontalDistance,
        target.y + Math.sin(orbit.pitch) * orbit.distance,
        target.z + Math.cos(orbit.azimuth) * horizontalDistance,
      );
      camera.lookAt(target);
      camera.updateMatrixWorld();
    },
  };
}
