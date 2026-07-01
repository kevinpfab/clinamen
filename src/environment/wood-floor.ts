import * as THREE from "three";
import woodAlbedoUrl from "../assets/wood-floor-albedo.svg?url";
import woodNormalUrl from "../assets/wood-floor-normal.svg?url";
import woodRoughnessUrl from "../assets/wood-floor-roughness.svg?url";
import { circularPoolSegments } from "../config";
import { renderer, scene } from "../core/stage";

// A static textured circular wood floor surrounding the pool. These maps are
// stored as assets so mobile startup does not spend time baking canvas textures.
const textureLoader = new THREE.TextureLoader();

function loadWoodTexture(url: string, srgb: boolean) {
  const texture = textureLoader.load(url);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5.5, 5.5);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}

export function createCircularWoodFloorGeometry(outerExtent: number, poolRadius: number) {
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

export const woodFloorTextures = {
  map: loadWoodTexture(woodAlbedoUrl, true),
  normalMap: loadWoodTexture(woodNormalUrl, false),
  roughnessMap: loadWoodTexture(woodRoughnessUrl, false),
};

export const woodFloorMaterial = new THREE.MeshStandardMaterial({
  map: woodFloorTextures.map,
  normalMap: woodFloorTextures.normalMap,
  roughnessMap: woodFloorTextures.roughnessMap,
  color: 0xcdb688,
  roughness: 0.82,
  metalness: 0.0,
});
woodFloorMaterial.normalScale.set(0.45, 0.45);

export const woodFloor = new THREE.Mesh(
  createCircularWoodFloorGeometry(40, 4),
  woodFloorMaterial,
);
woodFloor.rotation.x = -Math.PI / 2;
woodFloor.position.y = -0.012;
woodFloor.receiveShadow = false;
scene.add(woodFloor);

export function disposeWoodFloor() {
  scene.remove(woodFloor);
  woodFloor.geometry.dispose();
  woodFloorMaterial.dispose();
  woodFloorTextures.map.dispose();
  woodFloorTextures.normalMap.dispose();
  woodFloorTextures.roughnessMap.dispose();
}
