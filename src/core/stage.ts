import * as THREE from "three";
import {
  enableSceneShadows,
  rendererAntialias,
  rendererPixelRatioLimit,
} from "../config";

// The Stage owns the foundational Three.js singletons — renderer, scene, camera,
// clock — plus the DOM mount. main.ts creates it before loading scene systems.
export type Stage = {
  app: HTMLDivElement;
  clock: THREE.Clock;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
};

export let app: HTMLDivElement;
export let clock: THREE.Clock;
export let scene: THREE.Scene;

// The point the camera orbits and looks at; shared with the camera controls.
export const cameraTarget = new THREE.Vector3(0, 0, 0);

export let renderer: THREE.WebGLRenderer;
export let camera: THREE.PerspectiveCamera;
let stage: Stage | null = null;

function createRenderer() {
  const nextRenderer = new THREE.WebGLRenderer({
    antialias: rendererAntialias,
    alpha: false,
    powerPreference: "high-performance",
  });
  nextRenderer.setPixelRatio(Math.min(window.devicePixelRatio, rendererPixelRatioLimit));
  nextRenderer.setSize(window.innerWidth, window.innerHeight);
  nextRenderer.shadowMap.enabled = enableSceneShadows;
  nextRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  nextRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  nextRenderer.toneMappingExposure = 1.0;
  nextRenderer.outputColorSpace = THREE.SRGBColorSpace;
  return nextRenderer;
}

function createCamera() {
  const nextCamera = new THREE.PerspectiveCamera(
    38,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.1,
    80,
  );
  nextCamera.position.set(0, 6.8, 8.8);
  nextCamera.lookAt(cameraTarget);
  return nextCamera;
}

export function createStage(): Stage {
  if (stage) {
    if (!renderer.domElement.isConnected) {
      app.appendChild(renderer.domElement);
    }
    return stage;
  }

  const appElement = document.querySelector<HTMLDivElement>("#app");
  if (!appElement) {
    throw new Error("Microtonal Basin could not find its app container.");
  }

  app = appElement;
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd6c097);
  cameraTarget.set(0, 0, 0);
  renderer = createRenderer();
  camera = createCamera();
  app.appendChild(renderer.domElement);

  stage = {
    app,
    clock,
    scene,
    renderer,
    camera,
  };
  return stage;
}

export function disposeStage() {
  if (!stage) {
    return;
  }

  renderer.domElement.remove();
  renderer.dispose();
  scene.clear();
  stage = null;
}

export function renderScene() {
  renderer.render(scene, camera);
}
