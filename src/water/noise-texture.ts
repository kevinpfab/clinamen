import * as THREE from "three";
import { waterUniforms } from "./uniforms";

// A tiling value-noise texture shared by the full-screen water and floor
// shaders. They previously evaluated hash-sin value noise in ALU a dozen
// times per pixel; a small repeating texture lookup is cheaper (especially
// on mobile GPUs) and avoids the sin-hash precision artifacts some drivers
// show at large arguments. The bake matches the old function: unit lattice,
// smoothstep interpolation, sampled in the shader as noise(p) =
// texture(uNoiseMap, p / NOISE_PERIOD).
const noiseTextureSize = 256;

// The world-space repeat length of the noise, in old-valueNoise argument
// units. Interpolated into shaders as an inverse scale.
export const noisePeriod = 32;

function latticeHash(x: number, y: number, seed: number) {
  const wrappedX = ((x % noisePeriod) + noisePeriod) % noisePeriod;
  const wrappedY = ((y % noisePeriod) + noisePeriod) % noisePeriod;
  const s = Math.sin(wrappedX * 127.1 + wrappedY * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

function bakedValueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = latticeHash(x0, y0, seed);
  const b = latticeHash(x0 + 1, y0, seed);
  const c = latticeHash(x0, y0 + 1, seed);
  const d = latticeHash(x0 + 1, y0 + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ux), THREE.MathUtils.lerp(c, d, ux), uy);
}

function createNoiseTexture() {
  const data = new Uint8Array(noiseTextureSize * noiseTextureSize * 4);
  const texelToNoise = noisePeriod / noiseTextureSize;

  for (let ty = 0; ty < noiseTextureSize; ty += 1) {
    for (let tx = 0; tx < noiseTextureSize; tx += 1) {
      const x = (tx + 0.5) * texelToNoise;
      const y = (ty + 0.5) * texelToNoise;
      const index = (ty * noiseTextureSize + tx) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        data[index + channel] = Math.round(bakedValueNoise(x, y, channel) * 255);
      }
    }
  }

  const texture = new THREE.DataTexture(
    data,
    noiseTextureSize,
    noiseTextureSize,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.name = "Basin tiling value noise";
  return texture;
}

export const noiseTexture = createNoiseTexture();
waterUniforms.uNoiseMap.value = noiseTexture;

export function disposeNoiseTexture() {
  noiseTexture.dispose();
}
