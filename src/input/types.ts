import * as THREE from "three";
import type { BowlBody } from "../bowls/types";

export type DragState = {
  bowl: BowlBody;
  pointerId: number;
  offset: THREE.Vector2;
  lastRippleAt: number;
  lastRipplePoint: THREE.Vector2;
  releaseVelocity: THREE.Vector2;
  samples: Array<{
    point: THREE.Vector2;
    time: number;
  }>;
};

export type CameraOrbitState = {
  azimuth: number;
  pitch: number;
  distance: number;
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
  hasUserControl: boolean;
};

export type CameraOrbitDragState = {
  pointerId: number;
  previousClientX: number;
  previousClientY: number;
};
