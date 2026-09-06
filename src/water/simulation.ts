import * as THREE from "three";
import {
  maxWaterImpulses,
  waterSimulationSize,
  waterWaveSpeed,
} from "../config";
import { debugSettings } from "../settings";
import { basinMaskChunk } from "./shader-chunks";
import type { SharedWaterUniforms } from "./uniforms";
import type { WaterSimulationUniforms } from "./types";
import { WaterImpulseQueue } from "./impulses";

// A GPGPU height-field simulation rendered to ping-pong float targets. Bowl
// drags, collisions, and flow jets push impulses in; the water surface and
// reflections read the resulting height/velocity/energy texture each frame.
export type WaterSimulation = {
  queueImpulse: (x: number, z: number, radius: number, strength: number) => void;
  queueDirectionalImpulse: (
    x: number,
    z: number,
    direction: THREE.Vector2,
    radius: number,
    strength: number,
  ) => void;
  queueDirectionalImpulseComponents: (
    x: number,
    z: number,
    directionX: number,
    directionZ: number,
    radius: number,
    strength: number,
  ) => void;
  clear: () => void;
  update: (delta: number) => void;
  dispose: () => void;
};

type WaterSimulationDeps = {
  renderer: THREE.WebGLRenderer;
  uniforms: SharedWaterUniforms;
};

const waterSimulationOptions = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

const simulationVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const simulationFragmentShader = `
  precision highp float;

  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform vec4 uSimWorld;
  uniform vec4 uPoolData;
  uniform vec4 uImpulseData[${maxWaterImpulses}];
  uniform int uImpulseCount;
  uniform float uDelta;
  uniform float uWaveKick;
  uniform float uWallReflectance;

  varying vec2 vUv;

  ${basinMaskChunk}

  float basinWall(vec2 p) {
    float radius = max(uPoolData.z, 0.001);
    float maskSoftness = clamp(uPoolData.w * 0.22, 0.060, 0.180);
    float softness = max(uPoolData.w * 0.62, maskSoftness * 2.0);
    float d = length(p - uPoolData.xy);
    return smoothstep(radius - softness, radius - maskSoftness * 0.30, d);
  }

  float sampledHeight(vec2 uv, float fallbackHeight) {
    vec2 safeUv = clamp(uv, 0.001, 0.999);
    vec2 p = uSimWorld.xy + safeUv * uSimWorld.zw;
    float mask = basinMask(p);
    float neighbor = texture2D(uState, safeUv).r;
    return mix(fallbackHeight * 0.82, neighbor, mask);
  }

  void main() {
    vec4 state = texture2D(uState, vUv);
    float height = state.r;
    float velocity = state.g;
    float energy = state.b;
    float foam = state.a;

    float leftHeight = sampledHeight(vUv + vec2(-uTexel.x, 0.0), height);
    float rightHeight = sampledHeight(vUv + vec2(uTexel.x, 0.0), height);
    float downHeight = sampledHeight(vUv + vec2(0.0, -uTexel.y), height);
    float upHeight = sampledHeight(vUv + vec2(0.0, uTexel.y), height);
    float downLeftHeight = sampledHeight(vUv + vec2(-uTexel.x, -uTexel.y), height);
    float downRightHeight = sampledHeight(vUv + vec2(uTexel.x, -uTexel.y), height);
    float upLeftHeight = sampledHeight(vUv + vec2(-uTexel.x, uTexel.y), height);
    float upRightHeight = sampledHeight(vUv + vec2(uTexel.x, uTexel.y), height);
    float cardinal = leftHeight + rightHeight + downHeight + upHeight;
    float diagonal = downLeftHeight + downRightHeight + upLeftHeight + upRightHeight;
    float laplacian = cardinal * 0.8 + diagonal * 0.2 - height * 4.0;
    float gradientEnergy = abs(leftHeight - rightHeight) + abs(downHeight - upHeight);

    float stepScale = clamp(uDelta * 60.0, 0.35, 1.65);
    velocity += laplacian * uWaveKick * stepScale;
    velocity *= pow(0.982, stepScale);
    height += velocity * 0.34 * stepScale;
    height *= pow(0.998, stepScale);
    energy += (abs(laplacian) * 0.092 + gradientEnergy * 0.034 + abs(velocity) * 0.018) * stepScale;
    energy *= pow(0.956, stepScale);

    // Foam has memory: it spawns where the water is agitated, decays over
    // about a second, and drifts downhill (semi-Lagrangian pull from the
    // up-slope neighbor) so wakes leave dissolving trails instead of a
    // glow that switches off with the energy channel.
    vec2 heightGradient = vec2(rightHeight - leftHeight, upHeight - downHeight) * 0.5;
    vec2 foamSourceUv = clamp(vUv + heightGradient * uTexel * 60.0, 0.001, 0.999);
    foam = texture2D(uState, foamSourceUv).a;
    foam += smoothstep(0.30, 0.90, energy) * 0.030 * stepScale;
    foam *= pow(0.988, stepScale);

    vec2 p = uSimWorld.xy + vUv * uSimWorld.zw;
    float wall = basinWall(p);
    for (int i = 0; i < ${maxWaterImpulses}; i++) {
      if (i >= uImpulseCount) {
        break;
      }

      vec4 impulse = uImpulseData[i];
      float radius = max(impulse.z, 0.001);
      vec2 scaledOffset = (p - impulse.xy) / radius;
      // Laplacian-of-Gaussian displacement has zero area integral: a
      // disturbance redistributes water instead of adding a mound. A single
      // signed packet evolves under the wave equation, without a local spring
      // ringing independently at every texel.
      float q = dot(scaledOffset, scaledOffset) * 2.35;
      float envelope = exp(-q);
      float displacement = (1.0 - q) * envelope;
      height += displacement * impulse.w * 0.60;
      energy += abs(displacement * impulse.w) * 0.25;
    }

    // The wall band absorbs incident waves; reflectance dials the
    // absorption back so part of each wavefront rebounds off the rim and
    // interferes with later rings instead of dying at the edge.
    velocity -= height * wall * mix(0.080, 0.028, uWallReflectance) * stepScale;
    velocity *= pow(mix(1.0, mix(0.70, 0.995, uWallReflectance), wall), stepScale);
    height *= mix(1.0, mix(0.82, 0.998, uWallReflectance), wall * stepScale);
    energy *= mix(1.0, mix(0.58, 0.92, uWallReflectance), wall * stepScale);
    foam *= mix(1.0, 0.80, wall * stepScale);

    float mask = basinMask(p);
    height *= mask;
    velocity *= mask;
    energy *= mask;
    foam *= mask;

    gl_FragColor = vec4(
      clamp(height, -2.0, 2.0),
      clamp(velocity, -2.0, 2.0),
      clamp(energy, 0.0, 2.0),
      clamp(foam, 0.0, 1.5)
    );
  }
`;

export function createWaterSimulation({ renderer, uniforms }: WaterSimulationDeps): WaterSimulation {
  let readTarget = new THREE.WebGLRenderTarget(
    waterSimulationSize,
    waterSimulationSize,
    waterSimulationOptions,
  );
  let writeTarget = new THREE.WebGLRenderTarget(
    waterSimulationSize,
    waterSimulationSize,
    waterSimulationOptions,
  );
  readTarget.texture.name = "Basin water simulation read";
  writeTarget.texture.name = "Basin water simulation write";
  uniforms.uHeightMap.value = readTarget.texture;

  const impulseData = Array.from(
    { length: maxWaterImpulses },
    () => new THREE.Vector4(0, 0, 0, 0),
  );
  const pendingImpulses = new WaterImpulseQueue(maxWaterImpulses);
  const simulationUniforms: WaterSimulationUniforms & Record<string, THREE.IUniform> = {
    uState: { value: readTarget.texture },
    uTexel: { value: new THREE.Vector2(1 / waterSimulationSize, 1 / waterSimulationSize) },
    uSimWorld: uniforms.uSimWorld,
    uPoolData: uniforms.uPoolData,
    uImpulseData: { value: impulseData },
    uImpulseCount: { value: 0 },
    uDelta: { value: 1 / 60 },
    uWaveKick: { value: 0.64 },
    uWallReflectance: { value: debugSettings.wallReflectance },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: simulationUniforms,
    vertexShader: simulationVertexShader,
    fragmentShader: simulationFragmentShader,
  });

  const simulationScene = new THREE.Scene();
  const simulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simulationQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  simulationScene.add(simulationQuad);

  const previousClearColor = new THREE.Color();

  function queueImpulse(x: number, z: number, radius: number, strength: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || !Number.isFinite(strength)) {
      return;
    }

    const clampedRadius = THREE.MathUtils.clamp(radius, 0.045, 2.2);
    const clampedStrength = THREE.MathUtils.clamp(strength, -0.42, 0.42);
    if (Math.abs(clampedStrength) < 0.001) {
      return;
    }

    pendingImpulses.enqueue(x, z, clampedRadius, clampedStrength);
  }

  function queueDirectionalImpulseComponents(
    x: number,
    z: number,
    directionX: number,
    directionZ: number,
    radius: number,
    strength: number,
  ) {
    const directionLength = Math.hypot(directionX, directionZ);
    if (directionLength < 0.0001) {
      queueImpulse(x, z, radius, strength);
      return;
    }

    const flowDirectionX = directionX / directionLength;
    const flowDirectionZ = directionZ / directionLength;
    const tangentX = -flowDirectionZ;
    const tangentZ = flowDirectionX;
    const leadingRadius = radius * 0.72;
    const shoulderRadius = radius * 0.56;
    const shoulderOffset = radius * 0.68;
    queueImpulse(
      x + flowDirectionX * radius * 0.48,
      z + flowDirectionZ * radius * 0.48,
      leadingRadius,
      strength * 0.72,
    );
    queueImpulse(
      x - flowDirectionX * radius * 0.42,
      z - flowDirectionZ * radius * 0.42,
      radius * 0.92,
      -strength * 0.44,
    );
    queueImpulse(
      x + tangentX * shoulderOffset,
      z + tangentZ * shoulderOffset,
      shoulderRadius,
      strength * 0.18,
    );
    queueImpulse(
      x - tangentX * shoulderOffset,
      z - tangentZ * shoulderOffset,
      shoulderRadius,
      strength * 0.18,
    );
    queueImpulse(
      x - flowDirectionX * radius * 1.20,
      z - flowDirectionZ * radius * 1.20,
      radius * 1.34,
      -strength * 0.16,
    );
  }

  // Clear to transparent black: alpha is the foam channel and must start at 0.
  function clearTarget(target: THREE.WebGLRenderTarget) {
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(null);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  return {
    queueImpulse,
    queueDirectionalImpulse(x, z, direction, radius, strength) {
      queueDirectionalImpulseComponents(x, z, direction.x, direction.y, radius, strength);
    },
    queueDirectionalImpulseComponents,

    clear() {
      pendingImpulses.clear();
      simulationUniforms.uImpulseCount.value = 0;
      clearTarget(readTarget);
      clearTarget(writeTarget);
    },

    update(delta: number) {
      const impulseCount = Math.min(pendingImpulses.count, maxWaterImpulses);
      let impulseIndex = 0;
      for (const impulse of pendingImpulses.entries()) {
        impulseData[impulseIndex].set(
          impulse.x,
          impulse.z,
          impulse.radius,
          impulse.strength,
        );
        impulseIndex += 1;
      }
      for (let i = impulseCount; i < maxWaterImpulses; i += 1) {
        impulseData[i].set(0, 0, 0, 0);
      }

      simulationUniforms.uState.value = readTarget.texture;
      simulationUniforms.uImpulseCount.value = impulseCount;
      const clampedDelta = Math.min(delta, 0.04);
      simulationUniforms.uDelta.value = clampedDelta;

      // Derive the integration constant from the wave speed in world units so
      // propagation remains consistent across basin sizes and devices.
      // courant2 = (c * dt / dx)^2; the shader applies uWaveKick * stepScale to
      // velocity and 0.34 * stepScale to height. The 0.8 cardinal / 0.2 diagonal
      // stencil approximates 1.2 * dx^2 * laplacian(height), so fold that scale
      // out as well. Keep its unnormalized coefficient below the stencil's
      // stability limit (~0.625) with margin.
      const texelWorldSize = uniforms.uSimWorld.value.z / waterSimulationSize;
      const stepScale = THREE.MathUtils.clamp(clampedDelta * 60, 0.35, 1.65);
      const courant2 = Math.min(
        ((waterWaveSpeed * clampedDelta) / Math.max(texelWorldSize, 0.0001)) ** 2,
        0.5,
      );
      simulationUniforms.uWaveKick.value = courant2 / (1.2 * 0.34 * stepScale * stepScale);
      simulationUniforms.uWallReflectance.value = THREE.MathUtils.clamp(
        debugSettings.wallReflectance,
        0,
        1,
      );
      renderer.setRenderTarget(writeTarget);
      renderer.render(simulationScene, simulationCamera);
      renderer.setRenderTarget(null);

      const nextRead = writeTarget;
      writeTarget = readTarget;
      readTarget = nextRead;
      uniforms.uHeightMap.value = readTarget.texture;
      pendingImpulses.clear();
    },

    dispose() {
      material.dispose();
      simulationQuad.geometry.dispose();
      readTarget.dispose();
      writeTarget.dispose();
    },
  };
}
