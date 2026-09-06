import * as THREE from "three";
import { waterSimulationSize } from "../config";
import { basinMaskChunk } from "./shader-chunks";
import type { SharedWaterUniforms } from "./uniforms";

// Composite wave-state prepass. The simulation, interaction, and bowl fields
// are combined once per frame at field resolution into:
//   waveState   = (waveHeight, waveSlope, waveEnergy, contactAccent)
//   waveDetail  = (normalHeight, meniscusSource, bowlFootprint, simEnergy)
//   waveDerived = (slopeX, slopeY, causticFocus, foam)
// The full-screen water surface and basin floor shaders then read one or two
// texels here instead of independently reconstructing the wave state from
// three textures per pixel — and both layers see identical wave data by
// construction. State and detail share one MRT pass, so each source field is
// sampled only once; derived slopes still run afterward on the completed data.
export type WaveState = {
  update: () => void;
  dispose: () => void;
};

type WaveStateDeps = {
  renderer: THREE.WebGLRenderer;
  uniforms: SharedWaterUniforms;
};

const waveFieldOptions = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
  colorSpace: THREE.NoColorSpace,
};

const combineVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const combineHeader = `
  precision highp float;

  uniform sampler2D uHeightMap;
  uniform sampler2D uBowlFieldMap;
  uniform sampler2D uInteractionFieldMap;
  uniform vec4 uSimWorld;
  uniform vec4 uPoolData;

  varying vec2 vUv;

  ${basinMaskChunk}
`;

const combineFragmentShader = `
  ${combineHeader}

  layout(location = 0) out vec4 waveState;
  layout(location = 1) out vec4 waveDetail;

  void main() {
    vec2 p = uSimWorld.xy + vUv * uSimWorld.zw;
    float mask = basinMask(p);
    vec3 sim = texture2D(uHeightMap, vUv).rgb * mask;
    vec4 interaction = texture2D(uInteractionFieldMap, vUv);
    vec4 bowl = texture2D(uBowlFieldMap, vUv);
    float simulated = sim.r;
    float simulationEnergy = sim.b;
    float waveHeight = simulated * 0.98 + interaction.x + bowl.x * 0.44;
    float waveSlope = abs(simulated) * 1.90
      + simulationEnergy * 0.18
      + interaction.y
      + bowl.y * 0.28;
    float waveEnergy = simulationEnergy * 0.78
      + abs(simulated) * 0.90
      + interaction.z
      + bowl.y * 0.72;
    float normalHeight = sim.r * 0.360
      + sim.b * 0.007
      + interaction.x * 0.150
      + interaction.z * 0.004
      + bowl.x * 0.056;
    waveState = vec4(waveHeight, waveSlope, waveEnergy, interaction.w);
    waveDetail = vec4(normalHeight, bowl.z, bowl.a, sim.b);
  }
`;

const waveDerivedFragmentShader = `
  precision highp float;

  uniform sampler2D uWaveDetailMap;
  uniform sampler2D uWaveStateMap;
  uniform sampler2D uHeightMap;
  uniform vec4 uSimWorld;
  uniform vec2 uTexel;

  varying vec2 vUv;

  void main() {
    float left = texture2D(uWaveDetailMap, vUv - vec2(uTexel.x, 0.0)).r;
    float right = texture2D(uWaveDetailMap, vUv + vec2(uTexel.x, 0.0)).r;
    float down = texture2D(uWaveDetailMap, vUv - vec2(0.0, uTexel.y)).r;
    float up = texture2D(uWaveDetailMap, vUv + vec2(0.0, uTexel.y)).r;
    float center = texture2D(uWaveDetailMap, vUv).r;
    vec2 worldTexel = max(uSimWorld.zw * uTexel, vec2(0.0001));

    // Matches the previous forward-difference slope convention on the
    // surface shader: slope = -gradient(normalHeight) * 1.62.
    vec2 slope = vec2(left - right, down - up) / (worldTexel * 2.0) * 1.62;

    // Wave-focusing proxy for caustics: light converges where the surface
    // curves downward (negative Laplacian of the height field).
    float laplacian = (left + right + down + up - center * 4.0)
      / (worldTexel.x * worldTexel.y);
    float focus = max(-laplacian, 0.0) * 0.075;
    float energy = texture2D(uWaveStateMap, vUv).b;
    float caustic = clamp(focus * (0.55 + clamp(energy, 0.0, 1.2) * 0.45), 0.0, 1.4);
    float foam = texture2D(uHeightMap, vUv).a;

    gl_FragColor = vec4(slope, caustic, foam);
  }
`;

export function createWaveState({ renderer, uniforms }: WaveStateDeps): WaveState {
  const compositeTarget = new THREE.WebGLRenderTarget(
    waterSimulationSize,
    waterSimulationSize,
    { ...waveFieldOptions, count: 2 },
  );
  compositeTarget.textures[0].name = "Basin composite wave state";
  compositeTarget.textures[1].name = "Basin composite wave detail";
  const derivedTarget = new THREE.WebGLRenderTarget(
    waterSimulationSize,
    waterSimulationSize,
    waveFieldOptions,
  );
  derivedTarget.texture.name = "Basin derived wave slope";
  uniforms.uWaveStateMap.value = compositeTarget.textures[0];
  uniforms.uWaveDetailMap.value = compositeTarget.textures[1];
  uniforms.uWaveDerivedMap.value = derivedTarget.texture;

  const combineUniforms: Record<string, THREE.IUniform> = {
    uHeightMap: uniforms.uHeightMap,
    uBowlFieldMap: uniforms.uBowlFieldMap,
    uInteractionFieldMap: uniforms.uInteractionFieldMap,
    uSimWorld: uniforms.uSimWorld,
    uPoolData: uniforms.uPoolData,
  };

  const combineMaterial = new THREE.ShaderMaterial({
    uniforms: combineUniforms,
    vertexShader: combineVertexShader,
    fragmentShader: combineFragmentShader,
    glslVersion: THREE.GLSL3,
    toneMapped: false,
  });

  const derivedMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uWaveDetailMap: uniforms.uWaveDetailMap,
      uWaveStateMap: uniforms.uWaveStateMap,
      uHeightMap: uniforms.uHeightMap,
      uSimWorld: uniforms.uSimWorld,
      uTexel: {
        value: new THREE.Vector2(1 / waterSimulationSize, 1 / waterSimulationSize),
      },
    },
    vertexShader: combineVertexShader,
    fragmentShader: waveDerivedFragmentShader,
    toneMapped: false,
  });

  const passScene = new THREE.Scene();
  const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), combineMaterial);
  passScene.add(passQuad);

  function renderPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
    passQuad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(passScene, passCamera);
  }

  return {
    update() {
      renderPass(combineMaterial, compositeTarget);
      renderPass(derivedMaterial, derivedTarget);
      renderer.setRenderTarget(null);
    },

    dispose() {
      combineMaterial.dispose();
      derivedMaterial.dispose();
      passQuad.geometry.dispose();
      compositeTarget.dispose();
      derivedTarget.dispose();
    },
  };
}
