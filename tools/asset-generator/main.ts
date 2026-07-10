import * as THREE from "three";
// Reuse the piece's real bowl geometry so the generated marks match what the
// visitor actually sees on the water.
import { createInstancedBowlShellGeometry } from "../../src/bowls/geometry";

// --- Porcelain look, mirrored from src/bowls/materials.ts --------------------
// Kept as local constants (rather than importing the shared material) so the
// generator stays clear of the water-simulation uniform chain that module pulls
// in. If the piece's porcelain is retuned, mirror the change here.
const porcelainBaseColor = 0xf4efe3;
const porcelainBaseRoughness = 0.54;
const porcelainBaseClearcoat = 0.42;

function createPorcelainMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: porcelainBaseColor,
    roughness: porcelainBaseRoughness,
    metalness: 0,
    clearcoat: porcelainBaseClearcoat,
    clearcoatRoughness: 0.28,
    reflectivity: 0.48,
    ior: 1.48,
    side: THREE.DoubleSide,
  });
}

// Lighting mirrored from src/core/lighting.ts (only the two lights that
// actually contribute — fill/rim ship at intensity 0).
function addLighting(scene: THREE.Scene) {
  const hemisphere = new THREE.HemisphereLight(0xf7ffff, 0x006f90, 1.25);
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xfff2dc, 3.35);
  key.position.set(-1.45, 12, 0.95);
  key.up.set(0, 0, 1);
  scene.add(key);
  scene.add(key.target);
}

// --- Scene -------------------------------------------------------------------
const BOWL_RADIUS = 2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
addLighting(scene);

const bowl = new THREE.Mesh(
  createInstancedBowlShellGeometry(),
  createPorcelainMaterial(),
);
bowl.scale.setScalar(BOWL_RADIUS);
scene.add(bowl);

// Frame on the bowl's true bounds so any geometry retune stays centred.
const bounds = new THREE.Box3().setFromObject(bowl);
const boundsCenter = bounds.getCenter(new THREE.Vector3());
const boundsRadius = bounds.getBoundingSphere(new THREE.Sphere()).radius;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const FOV = 32;
// Front-on, tilted down so the rim opening reads even at 16px.
const ELEVATION = THREE.MathUtils.degToRad(42);

// Render the bowl into a fresh square/wide master canvas at high resolution;
// callers downscale from it for crisp, anti-aliased marks at every size.
function renderMaster(width: number, height: number, fitMargin: number) {
  renderer.setSize(width, height, false);

  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);
  const vFov = THREE.MathUtils.degToRad(FOV);
  const distance = (boundsRadius / Math.sin(vFov / 2)) * fitMargin;
  camera.position.set(
    boundsCenter.x,
    boundsCenter.y + distance * Math.sin(ELEVATION),
    boundsCenter.z + distance * Math.cos(ELEVATION),
  );
  camera.lookAt(boundsCenter);

  renderer.render(scene, camera);

  const master = document.createElement("canvas");
  master.width = width;
  master.height = height;
  master.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
  return master;
}

// Bigger margin on the wide OG card leaves the bowl breathing room instead of
// filling the full height of the banner.
const squareMaster = renderMaster(1024, 1024, 1.28);
const wideMaster = renderMaster(2400, 1260, 1.72);

// --- Downscale + export ------------------------------------------------------
function scaleTo(source: HTMLCanvasElement, width: number, height: number) {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return out;
}

function download(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

type ExportSpec = { label: string; filename: string; width: number; height: number };

type Card = {
  title: string;
  master: HTMLCanvasElement;
  aspect: number; // width / height
  previewWidth: number;
  exports: ExportSpec[];
};

const cards: Card[] = [
  {
    title: "Favicon",
    master: squareMaster,
    aspect: 1,
    previewWidth: 256,
    exports: [
      { label: "512", filename: "favicon-512.png", width: 512, height: 512 },
      { label: "180 (apple-touch)", filename: "apple-touch-icon.png", width: 180, height: 180 },
      { label: "32", filename: "favicon-32.png", width: 32, height: 32 },
      { label: "16", filename: "favicon-16.png", width: 16, height: 16 },
    ],
  },
  {
    title: "OG / social image (1200×630)",
    master: wideMaster,
    aspect: 1200 / 630,
    previewWidth: 600,
    exports: [{ label: "1200×630", filename: "og-image.png", width: 1200, height: 630 }],
  },
];

const previews = document.getElementById("previews")!;

for (const card of cards) {
  const el = document.createElement("div");
  el.className = "card";

  const previewHeight = Math.round(card.previewWidth / card.aspect);
  const preview = scaleTo(card.master, card.previewWidth, previewHeight);
  el.appendChild(preview);

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = card.title;
  el.appendChild(label);

  const actions = document.createElement("div");
  actions.className = "actions";
  for (const spec of card.exports) {
    const button = document.createElement("button");
    button.textContent = `Download ${spec.label}`;
    button.addEventListener("click", () => {
      download(scaleTo(card.master, spec.width, spec.height), spec.filename);
    });
    actions.appendChild(button);
  }
  el.appendChild(actions);

  previews.appendChild(el);
}
