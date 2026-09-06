import * as THREE from "three";
import {
  dragFastVelocityBlend,
  dragSlowVelocityBlend,
  dragStoppedVelocityRetention,
  dragVelocitySampleWindow,
  maxDragWorldSpeed,
  velocityWorldScale,
} from "../config";

type DragSample = { point: THREE.Vector2; time: number };

export type DragVelocity = {
  samples: DragSample[];
  heldVelocity: THREE.Vector2;
  releaseVelocity: THREE.Vector2;
  filteredReleaseVelocity: THREE.Vector2;
  lastMotionAt: number;
};

export function createDragVelocity(point: THREE.Vector2, time: number): DragVelocity {
  return {
    samples: [{ point: point.clone(), time }],
    heldVelocity: new THREE.Vector2(),
    releaseVelocity: new THREE.Vector2(),
    filteredReleaseVelocity: new THREE.Vector2(),
    lastMotionAt: time,
  };
}

// Treat the position after the latest event as stationary. Interpolating the
// start of the sample window keeps the estimate independent of event cadence;
// advancing `time` alone removes stale collision/wake velocity while held.
function sampleHeldVelocity(state: DragVelocity, time: number) {
  const samples = state.samples;
  const last = samples[samples.length - 1];
  const cutoff = Math.max(samples[0].time, time - dragVelocitySampleWindow);
  const velocity = state.heldVelocity.set(0, 0);
  if (last.time <= cutoff || time <= cutoff) {
    return velocity;
  }

  let first = samples[0];
  let next = first;
  for (let i = 1; i < samples.length; i += 1) {
    next = samples[i];
    if (next.time >= cutoff) {
      break;
    }
    first = next;
  }
  const fraction = next.time > first.time
    ? THREE.MathUtils.clamp((cutoff - first.time) / (next.time - first.time), 0, 1)
    : 0;
  velocity.copy(first.point).lerp(next.point, fraction);
  velocity.subVectors(last.point, velocity).divideScalar(time - cutoff);
  velocity.clampLength(0, maxDragWorldSpeed).divideScalar(velocityWorldScale);
  return velocity;
}

export function readDragVelocity(state: DragVelocity, time: number) {
  sampleHeldVelocity(state, time);
  const stoppedFor = Math.max(0, time - state.lastMotionAt);
  const freshness = Math.max(0, 1 - stoppedFor / dragVelocitySampleWindow);
  state.releaseVelocity.copy(state.filteredReleaseVelocity).multiplyScalar(
    freshness * Math.pow(dragStoppedVelocityRetention, stoppedFor),
  );
  return state;
}

export function pushDragVelocitySample(state: DragVelocity, point: THREE.Vector2, time: number) {
  const previous = state.samples[state.samples.length - 1];
  if (time <= previous.time) {
    return readDragVelocity(state, previous.time);
  }

  const moved = !point.equals(previous.point);
  state.samples.push({ point: point.clone(), time });
  const cutoff = time - dragVelocitySampleWindow;
  // Keep the sample immediately before the window for interpolation.
  while (state.samples.length > 2 && state.samples[1].time < cutoff) {
    state.samples.shift();
  }

  if (moved) {
    if (time - state.lastMotionAt >= dragVelocitySampleWindow) {
      state.filteredReleaseVelocity.set(0, 0);
    }
    const recent = sampleHeldVelocity(state, time);
    const blend = recent.lengthSq() >= state.filteredReleaseVelocity.lengthSq()
      ? dragFastVelocityBlend
      : dragSlowVelocityBlend;
    const elapsed = time - previous.time;
    // The tuning was authored for 60 Hz pointer events. Preserve its response
    // in seconds instead of applying the same blend once per event.
    state.filteredReleaseVelocity.lerp(recent, 1 - Math.pow(1 - blend, elapsed * 60));
    state.lastMotionAt = time;
  }
  return readDragVelocity(state, time);
}
