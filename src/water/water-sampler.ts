import * as THREE from "three";
import { renderer } from "../core/stage";
import { waterUniforms } from "./uniforms";

// CPU-side view of the wave field, for two-way coupling: the water pushes the
// bowls (bob, tilt, downhill drift) instead of only the bowls pushing water.
// A tiny byte-encoded downsample of the composite wave state is read back
// asynchronously (fence-synced, no pipeline stall); the couple of frames of
// latency is invisible on slowly drifting bowls.
const samplerSize = 64;
const heightScale = 1.2;
const slopeScale = 0.3;
const energyScale = 1 / 1.6;

const samplerTarget = new THREE.WebGLRenderTarget(samplerSize, samplerSize, {
  type: THREE.UnsignedByteType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
});
samplerTarget.texture.name = "Basin water readback sampler";

const samplerMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uWaveStateMap: waterUniforms.uWaveStateMap,
    uWaveDerivedMap: waterUniforms.uWaveDerivedMap,
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    uniform sampler2D uWaveStateMap;
    uniform sampler2D uWaveDerivedMap;

    varying vec2 vUv;

    void main() {
      vec4 waveState = texture2D(uWaveStateMap, vUv);
      vec2 slope = texture2D(uWaveDerivedMap, vUv).xy;
      gl_FragColor = vec4(
        clamp(waveState.r * ${heightScale.toFixed(3)} * 0.5 + 0.5, 0.0, 1.0),
        clamp(slope.x * ${slopeScale.toFixed(3)} * 0.5 + 0.5, 0.0, 1.0),
        clamp(slope.y * ${slopeScale.toFixed(3)} * 0.5 + 0.5, 0.0, 1.0),
        clamp(waveState.b * ${energyScale.toFixed(3)}, 0.0, 1.0)
      );
    }
  `,
});

const samplerScene = new THREE.Scene();
const samplerCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const samplerQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), samplerMaterial);
samplerScene.add(samplerQuad);

const readBuffer = new Uint8Array(samplerSize * samplerSize * 4);
const latest = new Uint8Array(samplerSize * samplerSize * 4);
let hasData = false;
let readPending = false;
let readbackSupported = typeof renderer.readRenderTargetPixelsAsync === "function";

export type WaterSurfaceSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  energy: number;
};

export function updateWaterSampler() {
  if (!readbackSupported) {
    return;
  }

  renderer.setRenderTarget(samplerTarget);
  renderer.render(samplerScene, samplerCamera);
  renderer.setRenderTarget(null);

  if (readPending) {
    return;
  }

  readPending = true;
  renderer
    .readRenderTargetPixelsAsync(samplerTarget, 0, 0, samplerSize, samplerSize, readBuffer)
    .then(() => {
      latest.set(readBuffer);
      hasData = true;
      readPending = false;
    })
    .catch(() => {
      readbackSupported = false;
      readPending = false;
    });
}

function decodeChannel(index: number, channel: number) {
  return latest[index * 4 + channel] / 255;
}

// Bilinear sample of the latest readback at a world position. Returns false
// (leaving `out` untouched) until the first readback completes.
export function sampleWaterSurface(x: number, z: number, out: WaterSurfaceSample) {
  if (!hasData) {
    return false;
  }

  const simWorld = waterUniforms.uSimWorld.value;
  const u = (x - simWorld.x) / Math.max(simWorld.z, 0.001);
  const v = (z - simWorld.y) / Math.max(simWorld.w, 0.001);
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    return false;
  }

  const fx = Math.min(u * samplerSize - 0.5, samplerSize - 1.001);
  const fy = Math.min(v * samplerSize - 0.5, samplerSize - 1.001);
  const x0 = Math.max(Math.floor(fx), 0);
  const y0 = Math.max(Math.floor(fy), 0);
  const x1 = Math.min(x0 + 1, samplerSize - 1);
  const y1 = Math.min(y0 + 1, samplerSize - 1);
  const tx = THREE.MathUtils.clamp(fx - x0, 0, 1);
  const ty = THREE.MathUtils.clamp(fy - y0, 0, 1);

  const i00 = y0 * samplerSize + x0;
  const i10 = y0 * samplerSize + x1;
  const i01 = y1 * samplerSize + x0;
  const i11 = y1 * samplerSize + x1;

  const bilinear = (channel: number) => {
    const top = THREE.MathUtils.lerp(
      decodeChannel(i00, channel),
      decodeChannel(i10, channel),
      tx,
    );
    const bottom = THREE.MathUtils.lerp(
      decodeChannel(i01, channel),
      decodeChannel(i11, channel),
      tx,
    );
    return THREE.MathUtils.lerp(top, bottom, ty);
  };

  out.height = (bilinear(0) * 2 - 1) / heightScale;
  out.slopeX = (bilinear(1) * 2 - 1) / slopeScale;
  out.slopeZ = (bilinear(2) * 2 - 1) / slopeScale;
  out.energy = bilinear(3) / energyScale;
  return true;
}

export function disposeWaterSampler() {
  samplerTarget.dispose();
  samplerMaterial.dispose();
  samplerQuad.geometry.dispose();
}
