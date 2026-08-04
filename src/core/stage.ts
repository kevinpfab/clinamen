import * as THREE from "three";
import {
  enableSceneShadows,
  rendererAntialias,
  rendererPixelRatioLimit,
} from "../config";

// The Stage owns the foundational Three.js objects — renderer, scene, camera,
// clock — plus the DOM mount. It is the only thing main.ts builds directly;
// every scene system is then constructed from it and hands its resources back
// on dispose.
export type Stage = {
  container: HTMLDivElement;
  clock: THREE.Clock;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  // The point the camera orbits and looks at; shared with the camera controls.
  cameraTarget: THREE.Vector3;
  // The scene's resting background, kept so the intro can fade back to it.
  backgroundColor: THREE.Color;
  dispose: () => void;
};

const stageBackgroundColor = 0xd6c097;

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({
    antialias: rendererAntialias,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, rendererPixelRatioLimit));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = enableSceneShadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    38,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.1,
    80,
  );
  camera.position.set(0, 6.8, 8.8);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function createStage(): Stage {
  const container = document.querySelector<HTMLDivElement>("#app");
  if (!container) {
    throw new Error("clinamen could not find its app container.");
  }

  const backgroundColor = new THREE.Color(stageBackgroundColor);
  const scene = new THREE.Scene();
  scene.background = backgroundColor.clone();

  const renderer = createRenderer();
  container.appendChild(renderer.domElement);

  return {
    container,
    clock: new THREE.Clock(),
    scene,
    renderer,
    camera: createCamera(),
    cameraTarget: new THREE.Vector3(0, 0, 0),
    backgroundColor,
    dispose() {
      renderer.domElement.remove();
      renderer.dispose();
      scene.clear();
    },
  };
}
