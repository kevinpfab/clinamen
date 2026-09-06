import * as THREE from "three";
import type { DragVelocity } from "./drag-velocity";
import type { BowlBody } from "../bowls/types";

export type DragState = {
  bowl: BowlBody;
  pointerId: number;
  offset: THREE.Vector2;
  velocity: DragVelocity;
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
