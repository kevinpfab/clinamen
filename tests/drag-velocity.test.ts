import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
  dragVelocitySampleWindow,
  maxDragWorldSpeed,
  velocityWorldScale,
} from "../src/config";
import {
  createDragVelocity,
  pushDragVelocitySample,
  readDragVelocity,
} from "../src/input/drag-velocity";

function constantDrag(eventRate: number, duration = 0.4) {
  const state = createDragVelocity(new THREE.Vector2(), 0);
  const events = Math.round(duration * eventRate);
  for (let i = 1; i <= events; i += 1) {
    const time = i / eventRate;
    pushDragVelocitySample(state, new THREE.Vector2(time, time * 0.5), time);
  }
  return state;
}

describe("drag velocity", () => {
  test("a held bowl stops without another pointer event and cannot fling on release", () => {
    const state = constantDrag(60);
    expect(state.heldVelocity.length()).toBeGreaterThan(0);
    expect(state.releaseVelocity.length()).toBeGreaterThan(0);

    readDragVelocity(state, 0.4 + dragVelocitySampleWindow * 0.5);
    expect(state.heldVelocity.x).toBeCloseTo(0.5 / velocityWorldScale, 10);

    readDragVelocity(state, 0.4 + dragVelocitySampleWindow + 0.001);
    expect(state.heldVelocity.length()).toBe(0);
    expect(state.releaseVelocity.length()).toBe(0);

    pushDragVelocitySample(state, new THREE.Vector2(0.4, 0.2), 1.4);
    expect(state.heldVelocity.length()).toBe(0);
    expect(state.releaseVelocity.length()).toBe(0);
  });

  test("pointerup ages release momentum even when there were no intervening frames", () => {
    const state = constantDrag(60);
    pushDragVelocitySample(state, new THREE.Vector2(0.4, 0.2), 1.4);
    expect(state.releaseVelocity.length()).toBe(0);
  });

  test("a short held release uses the same stop age as the preceding frame", () => {
    const state = constantDrag(60);
    const time = 0.4 + dragVelocitySampleWindow * 0.5;
    readDragVelocity(state, time);
    const releaseBeforePointerUp = state.releaseVelocity.clone();
    expect(releaseBeforePointerUp.length()).toBeGreaterThan(0);
    pushDragVelocitySample(state, new THREE.Vector2(0.4, 0.2), time);
    expect(state.releaseVelocity.distanceTo(releaseBeforePointerUp)).toBe(0);
  });

  test("constant motion and release filtering agree across pointer event rates", () => {
    // This short gesture exercises the filter's attack before it settles.
    const states = [30, 60, 120].map((rate) => constantDrag(rate, 1 / 15));
    for (const state of states) {
      expect(state.heldVelocity.x).toBeCloseTo(1 / velocityWorldScale, 10);
      expect(state.heldVelocity.y).toBeCloseTo(0.5 / velocityWorldScale, 10);
      expect(state.releaseVelocity.distanceTo(states[0].releaseVelocity)).toBeLessThan(1e-10);
    }
  });

  test("frame reads do not change subsequent velocity or the release result", () => {
    const withFrames = constantDrag(60);
    const withoutFrames = constantDrag(60);
    const stopTime = 0.4 + dragVelocitySampleWindow * 0.75;
    for (let time = 0.4; time < stopTime; time += 1 / 240) {
      readDragVelocity(withFrames, time);
    }
    readDragVelocity(withFrames, stopTime);
    readDragVelocity(withoutFrames, stopTime);
    expect(withFrames.heldVelocity.distanceTo(withoutFrames.heldVelocity)).toBe(0);
    expect(withFrames.releaseVelocity.distanceTo(withoutFrames.releaseVelocity)).toBe(0);

    const position = new THREE.Vector2(0.41, 0.2);
    pushDragVelocitySample(withFrames, position, 0.5);
    pushDragVelocitySample(withoutFrames, position, 0.5);
    expect(withFrames.releaseVelocity.distanceTo(withoutFrames.releaseVelocity)).toBe(0);
  });

  test("a small move after a long hold does not restore the previous fling", () => {
    const state = constantDrag(60);
    pushDragVelocitySample(state, new THREE.Vector2(0.4, 0.2), 1.4);
    pushDragVelocitySample(state, new THREE.Vector2(0.4001, 0.2), 1.41);
    expect(state.releaseVelocity.length()).toBeLessThan(0.001);
    expect(state.releaseVelocity.y).toBe(0);
  });

  test("very short event intervals remain finite and respect the world speed limit", () => {
    const state = createDragVelocity(new THREE.Vector2(), 0);
    pushDragVelocitySample(state, new THREE.Vector2(100, 100), 0.00001);
    expect(state.heldVelocity.length()).toBeCloseTo(maxDragWorldSpeed / velocityWorldScale, 10);
    pushDragVelocitySample(state, new THREE.Vector2(200, 200), 0.00001);
    expect(Number.isFinite(state.releaseVelocity.length())).toBe(true);
  });
});
