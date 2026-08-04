import * as THREE from "three";
import woodAlbedoUrl from "../assets/wood-floor-albedo.svg?url";
import woodNormalUrl from "../assets/wood-floor-normal.svg?url";
import woodRoughnessUrl from "../assets/wood-floor-roughness.svg?url";
import { circularPoolSegments } from "../config";

// A static textured circular wood floor surrounding the pool. These maps are
// stored as assets so mobile startup does not spend time baking canvas textures.
export type WoodFloor = {
  setPoolRadius: (poolRadius: number) => void;
  dispose: () => void;
};

type WoodFloorDeps = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
};

// How far the boards extend past the basin rim, in world units.
const woodFloorMargin = 34;

function createCircularWoodFloorGeometry(outerExtent: number, poolRadius: number) {
  const halfExtent = outerExtent / 2;
  const holeRadius = Math.min(poolRadius, halfExtent - 0.01);
  const shape = new THREE.Shape();
  shape.moveTo(-halfExtent, -halfExtent);
  shape.lineTo(halfExtent, -halfExtent);
  shape.lineTo(halfExtent, halfExtent);
  shape.lineTo(-halfExtent, halfExtent);
  shape.lineTo(-halfExtent, -halfExtent);

  const poolHole = new THREE.Path();
  poolHole.moveTo(holeRadius, 0);
  for (let i = 1; i <= circularPoolSegments; i += 1) {
    const angle = -(i / circularPoolSegments) * Math.PI * 2;
    poolHole.lineTo(Math.cos(angle) * holeRadius, Math.sin(angle) * holeRadius);
  }
  shape.holes.push(poolHole);

  const geometry = new THREE.ShapeGeometry(shape);
  const positions = geometry.getAttribute("position");
  const uvs = geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i += 1) {
    uvs.setXY(
      i,
      (positions.getX(i) + halfExtent) / outerExtent,
      (positions.getY(i) + halfExtent) / outerExtent,
    );
  }
  uvs.needsUpdate = true;
  return geometry;
}

export function createWoodFloor({ scene, renderer }: WoodFloorDeps): WoodFloor {
  const textureLoader = new THREE.TextureLoader();
  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

  function loadWoodTexture(url: string, srgb: boolean) {
    const texture = textureLoader.load(url);
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5.5, 5.5);
    texture.anisotropy = maxAnisotropy;
    return texture;
  }

  const textures = {
    map: loadWoodTexture(woodAlbedoUrl, true),
    normalMap: loadWoodTexture(woodNormalUrl, false),
    roughnessMap: loadWoodTexture(woodRoughnessUrl, false),
  };

  const material = new THREE.MeshStandardMaterial({
    map: textures.map,
    normalMap: textures.normalMap,
    roughnessMap: textures.roughnessMap,
    color: 0xcdb688,
    roughness: 0.82,
    metalness: 0.0,
  });
  material.normalScale.set(0.45, 0.45);

  // NaN until the first sizing pass, so the placeholder geometry below is
  // always replaced once.
  let builtPoolRadius = Number.NaN;

  const mesh = new THREE.Mesh(createCircularWoodFloorGeometry(40, 4), material);
  mesh.name = "Wood floor";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.012;
  mesh.receiveShadow = false;
  scene.add(mesh);

  return {
    setPoolRadius(poolRadius: number) {
      // Earcutting a 192-segment hole is the most expensive thing on the resize
      // path, and the floor only depends on the basin radius — which most
      // resize events (an iOS URL bar sliding away, say) leave untouched.
      if (builtPoolRadius === poolRadius) {
        return;
      }

      builtPoolRadius = poolRadius;
      mesh.geometry.dispose();
      mesh.geometry = createCircularWoodFloorGeometry(
        poolRadius * 2 + woodFloorMargin,
        poolRadius,
      );
    },

    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      textures.map.dispose();
      textures.normalMap.dispose();
      textures.roughnessMap.dispose();
    },
  };
}
