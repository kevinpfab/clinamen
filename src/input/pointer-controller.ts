import * as THREE from "three";
import {
  cameraOrbitDragSensitivity,
  cameraOrbitPitchSensitivity,
  cameraZoomSensitivity,
  dragFastVelocityBlend,
  dragSlowVelocityBlend,
  dragStoppedVelocityRetention,
  dragVelocitySampleWindow,
  maxDragWorldSpeed,
  velocityWorldScale,
} from "../config";
import { camera, renderer } from "../core/stage";
import { applyCameraOrbit, cameraOrbit } from "../core/camera-controls";
import type { BowlSystem } from "../bowls/system";
import type { BowlBody } from "../bowls/types";
import type { CameraOrbitDragState, DragState } from "./types";
import {
  emitDragReleaseRipple,
  updateDragWaterInteraction,
} from "../water/ripples";

type PointerControllerDeps = {
  bowlSystem: BowlSystem;
};

export type PointerController = {
  getDraggedBowl: () => BowlBody | null;
  cancelInteractions: () => void;
  dispose: () => void;
};

const pointerNdc = new THREE.Vector2();
const pointerWorld = new THREE.Vector3();
const pointerRaycaster = new THREE.Raycaster();
const waterInteractionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function createPointerController(deps: PointerControllerDeps): PointerController {
  let dragState: DragState | null = null;
  let cameraOrbitDragState: CameraOrbitDragState | null = null;
  let pinchState: { initialDistance: number; initialCameraDistance: number } | null = null;
  const activeTouches = new Map<number, { x: number; y: number }>();
  const disposers: Array<() => void> = [];

  function addDomListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) {
    renderer.domElement.addEventListener(type, listener, options);
    disposers.push(() => {
      renderer.domElement.removeEventListener(type, listener, options);
    });
  }

  function syncCamera() {
    applyCameraOrbit();
  }

  function getPointerWaterPoint(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    pointerRaycaster.setFromCamera(pointerNdc, camera);

    if (!pointerRaycaster.ray.intersectPlane(waterInteractionPlane, pointerWorld)) {
      return null;
    }

    return new THREE.Vector2(pointerWorld.x, pointerWorld.z);
  }

  function pushDragSample(state: DragState, point: THREE.Vector2, time: number) {
    state.samples.push({
      point: point.clone(),
      time,
    });

    const cutoff = time - Math.max(0.16, dragVelocitySampleWindow * 2);
    while (state.samples.length > 2 && state.samples[0].time < cutoff) {
      state.samples.shift();
    }

    updateDragReleaseVelocity(state);
  }

  function getRecentDragVelocity(state: DragState) {
    const last = state.samples[state.samples.length - 1];
    let first = state.samples[state.samples.length - 2];

    if (!first || !last) {
      return new THREE.Vector2(0, 0);
    }

    for (let i = state.samples.length - 2; i >= 0; i -= 1) {
      const sample = state.samples[i];
      if (last.time - sample.time > dragVelocitySampleWindow) {
        break;
      }
      first = sample;
    }

    if (first === last) {
      return new THREE.Vector2(0, 0);
    }

    const duration = Math.max(0.008, last.time - first.time);
    const worldVelocity = last.point.clone().sub(first.point).divideScalar(duration);

    if (worldVelocity.length() > maxDragWorldSpeed) {
      worldVelocity.setLength(maxDragWorldSpeed);
    }

    return worldVelocity.divideScalar(velocityWorldScale);
  }

  function updateDragReleaseVelocity(state: DragState) {
    const recentVelocity = getRecentDragVelocity(state);
    const recentSpeed = recentVelocity.length();
    const last = state.samples[state.samples.length - 1];
    const previous = state.samples[state.samples.length - 2];

    if (recentSpeed <= 0.0001) {
      const stationaryDuration = last && previous ? Math.max(0, last.time - previous.time) : 0;
      state.releaseVelocity.multiplyScalar(Math.pow(dragStoppedVelocityRetention, stationaryDuration));
      return;
    }

    const currentSpeed = state.releaseVelocity.length();
    const blend = recentSpeed >= currentSpeed ? dragFastVelocityBlend : dragSlowVelocityBlend;
    state.releaseVelocity.lerp(recentVelocity, blend);
  }

  function getDragVelocity(state: DragState) {
    return state.releaseVelocity.clone();
  }

  function moveDraggedBowl(state: DragState, point: THREE.Vector2, time: number) {
    const previous = new THREE.Vector2(state.bowl.mesh.position.x, state.bowl.mesh.position.z);
    const target = deps.bowlSystem.clampPointToBounds(state.bowl, point.add(state.offset));
    state.bowl.mesh.position.x = target.x;
    state.bowl.mesh.position.z = target.y;
    pushDragSample(state, target, time);
    state.bowl.velocity.copy(getDragVelocity(state));
    updateDragWaterInteraction(state, previous, target, time);
  }

  function startCameraOrbitDrag(event: PointerEvent) {
    event.preventDefault();
    renderer.domElement.setPointerCapture(event.pointerId);
    cameraOrbitDragState = {
      pointerId: event.pointerId,
      previousClientX: event.clientX,
      previousClientY: event.clientY,
    };
    renderer.domElement.classList.add("is-dragging");
  }

  function moveCameraOrbitDrag(event: PointerEvent) {
    if (!cameraOrbitDragState || cameraOrbitDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - cameraOrbitDragState.previousClientX;
    const deltaY = event.clientY - cameraOrbitDragState.previousClientY;
    cameraOrbitDragState.previousClientX = event.clientX;
    cameraOrbitDragState.previousClientY = event.clientY;

    cameraOrbit.azimuth -= deltaX * cameraOrbitDragSensitivity;
    cameraOrbit.pitch = THREE.MathUtils.clamp(
      cameraOrbit.pitch + deltaY * cameraOrbitPitchSensitivity,
      cameraOrbit.minPitch,
      cameraOrbit.maxPitch,
    );
    cameraOrbit.hasUserControl = true;
    syncCamera();
  }

  function finishCameraOrbitDrag(event: PointerEvent) {
    if (!cameraOrbitDragState || cameraOrbitDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }

    renderer.domElement.classList.remove("is-dragging");
    cameraOrbitDragState = null;
  }

  function cancelCameraOrbitDrag() {
    if (!cameraOrbitDragState) {
      return;
    }
    if (renderer.domElement.hasPointerCapture(cameraOrbitDragState.pointerId)) {
      renderer.domElement.releasePointerCapture(cameraOrbitDragState.pointerId);
    }
    renderer.domElement.classList.remove("is-dragging");
    cameraOrbitDragState = null;
  }

  function cancelBowlDrag() {
    if (!dragState) {
      return;
    }
    if (renderer.domElement.hasPointerCapture(dragState.pointerId)) {
      renderer.domElement.releasePointerCapture(dragState.pointerId);
    }
    renderer.domElement.classList.remove("is-dragging");
    dragState = null;
  }

  function getPinchDistance() {
    if (activeTouches.size < 2) {
      return null;
    }
    const points = Array.from(activeTouches.values());
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function beginPinch() {
    cancelCameraOrbitDrag();
    cancelBowlDrag();
    const distance = getPinchDistance();
    if (distance == null || distance <= 0) {
      return;
    }
    for (const pointerId of activeTouches.keys()) {
      if (!renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.setPointerCapture(pointerId);
      }
    }
    pinchState = {
      initialDistance: distance,
      initialCameraDistance: cameraOrbit.distance,
    };
  }

  function updatePinch() {
    if (!pinchState) {
      return;
    }
    const distance = getPinchDistance();
    if (distance == null || distance <= 0) {
      return;
    }
    const ratio = pinchState.initialDistance / distance;
    cameraOrbit.distance = THREE.MathUtils.clamp(
      pinchState.initialCameraDistance * ratio,
      cameraOrbit.minDistance,
      cameraOrbit.maxDistance,
    );
    cameraOrbit.hasUserControl = true;
    syncCamera();
  }

  function endPinch() {
    pinchState = null;
    if (activeTouches.size === 1) {
      const [pointerId, position] = Array.from(activeTouches.entries())[0];
      if (!renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.setPointerCapture(pointerId);
      }
      cameraOrbitDragState = {
        pointerId,
        previousClientX: position.x,
        previousClientY: position.y,
      };
      renderer.domElement.classList.add("is-dragging");
    }
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    const zoomFactor = Math.exp(event.deltaY * cameraZoomSensitivity);
    cameraOrbit.distance = THREE.MathUtils.clamp(
      cameraOrbit.distance * zoomFactor,
      cameraOrbit.minDistance,
      cameraOrbit.maxDistance,
    );
    cameraOrbit.hasUserControl = true;
    syncCamera();
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (event.pointerType !== "mouse") {
      activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouches.size >= 2) {
        event.preventDefault();
        beginPinch();
        return;
      }
    }

    const point = getPointerWaterPoint(event);
    if (!point) {
      startCameraOrbitDrag(event);
      return;
    }

    const bowl = deps.bowlSystem.findAtPoint(point);
    if (!bowl) {
      startCameraOrbitDrag(event);
      return;
    }

    event.preventDefault();
    renderer.domElement.setPointerCapture(event.pointerId);
    const bowlPoint = new THREE.Vector2(bowl.mesh.position.x, bowl.mesh.position.z);
    const time = performance.now() / 1000;
    dragState = {
      bowl,
      pointerId: event.pointerId,
      offset: bowlPoint.sub(point),
      lastRippleAt: time,
      lastRipplePoint: new THREE.Vector2(bowl.mesh.position.x, bowl.mesh.position.z),
      releaseVelocity: new THREE.Vector2(0, 0),
      samples: [],
    };
    bowl.velocity.set(0, 0);
    pushDragSample(dragState, new THREE.Vector2(bowl.mesh.position.x, bowl.mesh.position.z), time);
    renderer.domElement.classList.add("is-dragging");
  }

  function handlePointerMove(event: PointerEvent) {
    if (event.pointerType !== "mouse" && activeTouches.has(event.pointerId)) {
      activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pinchState) {
      event.preventDefault();
      updatePinch();
      return;
    }

    if (dragState && dragState.pointerId === event.pointerId) {
      const point = getPointerWaterPoint(event);
      if (!point) {
        return;
      }

      event.preventDefault();
      moveDraggedBowl(dragState, point, performance.now() / 1000);
      return;
    }

    moveCameraOrbitDrag(event);
  }

  function finishDrag(event: PointerEvent) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const releasedBowl = dragState.bowl;
    const releaseTime = performance.now() / 1000;
    const releasePoint = getPointerWaterPoint(event);
    const releaseTarget = releasePoint
      ? deps.bowlSystem.clampPointToBounds(releasedBowl, releasePoint.add(dragState.offset))
      : new THREE.Vector2(releasedBowl.mesh.position.x, releasedBowl.mesh.position.z);

    releasedBowl.mesh.position.x = releaseTarget.x;
    releasedBowl.mesh.position.z = releaseTarget.y;
    pushDragSample(dragState, releaseTarget, releaseTime);
    releasedBowl.velocity.copy(getDragVelocity(dragState));
    deps.bowlSystem.addMomentum(releasedBowl, releasedBowl.velocity.length() * 4.2);
    emitDragReleaseRipple(dragState, releaseTime);
    releasedBowl.angularVelocity += THREE.MathUtils.clamp(
      releasedBowl.velocity.length() * 0.18,
      0,
      0.16,
    ) * (releasedBowl.velocity.x >= 0 ? 1 : -1);
    deps.bowlSystem.keepInsideBounds(releasedBowl, 0.62);

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }

    renderer.domElement.classList.remove("is-dragging");
    dragState = null;
  }

  function finishPointerInteraction(event: PointerEvent) {
    if (event.pointerType !== "mouse") {
      activeTouches.delete(event.pointerId);
    }

    if (pinchState && activeTouches.size < 2) {
      endPinch();
      return;
    }

    finishDrag(event);
    finishCameraOrbitDrag(event);
  }

  function cancelInteractions() {
    cancelBowlDrag();
    cancelCameraOrbitDrag();
    pinchState = null;
    activeTouches.clear();
  }

  addDomListener("pointerdown", handlePointerDown);
  addDomListener("pointermove", handlePointerMove);
  addDomListener("pointerup", finishPointerInteraction);
  addDomListener("pointercancel", finishPointerInteraction);
  addDomListener("wheel", handleWheel, { passive: false });

  return {
    getDraggedBowl: () => dragState?.bowl ?? null,
    cancelInteractions,
    dispose() {
      cancelInteractions();
      for (const dispose of disposers.splice(0)) {
        dispose();
      }
    },
  };
}
