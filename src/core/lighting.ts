import * as THREE from "three";
import { enableSceneShadows } from "../config";

export type LightingSystem = {
  // Exposed so the intro can fade the world lights from black.
  hemisphere: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  dispose: () => void;
};

// The rig itself, built without a scene so the asset generator can pose a bowl
// under exactly the light the piece uses rather than mirroring these numbers.
// createLighting owns the scene wiring and the teardown; this owns the values.
export function createWorldLights() {
  const hemisphere = new THREE.HemisphereLight(0xf7ffff, 0x006f90, 1.25);

  const key = new THREE.DirectionalLight(0xfff2dc, 3.35);
  key.position.set(-1.45, 12, 0.95);
  key.up.set(0, 0, 1);
  key.castShadow = enableSceneShadows;
  if (enableSceneShadows) {
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.bias = -0.00008;
    key.shadow.normalBias = 0.026;
    key.shadow.radius = 4.5;
  }

  return { hemisphere, key };
}

// Key and hemisphere lighting for the scene. Deliberately two lights: every lit
// material Three compiles carries a loop over the scene's directional lights, so
// unused ones are not free.
export function createLighting(targetScene: THREE.Scene): LightingSystem {
  const { hemisphere: ambientLight, key: keyLight } = createWorldLights();
  targetScene.add(ambientLight, keyLight, keyLight.target);

  return {
    hemisphere: ambientLight,
    key: keyLight,
    dispose() {
      targetScene.remove(ambientLight, keyLight, keyLight.target);
      // Removing a light from the scene does not release the shadow map it
      // allocated. Inert while enableSceneShadows is false, but rebuilds are
      // routine now (hot reload, context-loss restore), so a leak here would
      // compound per rebuild rather than happen once.
      ambientLight.dispose();
      keyLight.dispose();
    },
  };
}
