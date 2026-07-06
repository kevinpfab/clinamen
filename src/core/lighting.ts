import * as THREE from "three";
import { enableSceneShadows } from "../config";
import { scene } from "./stage";

export type LightingSystem = {
  // Exposed so the intro can fade the world lights from black.
  hemisphere: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  dispose: () => void;
};

// Key, fill, rim, and hemisphere lighting for the scene.
export function createLighting(targetScene = scene): LightingSystem {
  const ambientLight = new THREE.HemisphereLight(0xf7ffff, 0x006f90, 1.25);
  targetScene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xfff2dc, 3.35);
  keyLight.position.set(-1.45, 12, 0.95);
  keyLight.up.set(0, 0, 1);
  keyLight.castShadow = enableSceneShadows;
  if (enableSceneShadows) {
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 24;
    keyLight.shadow.camera.left = -14;
    keyLight.shadow.camera.right = 14;
    keyLight.shadow.camera.top = 14;
    keyLight.shadow.camera.bottom = -14;
    keyLight.shadow.bias = -0.00008;
    keyLight.shadow.normalBias = 0.026;
    keyLight.shadow.radius = 4.5;
  }
  targetScene.add(keyLight);
  targetScene.add(keyLight.target);

  const fillLight = new THREE.DirectionalLight(0x7feeff, 0);
  fillLight.position.set(6, 5.5, 7);
  targetScene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0);
  rimLight.position.set(3, 4.2, -7);
  targetScene.add(rimLight);

  return {
    hemisphere: ambientLight,
    key: keyLight,
    dispose() {
      targetScene.remove(ambientLight, keyLight, keyLight.target, fillLight, rimLight);
    },
  };
}
