import * as THREE from "three";
import { bowlFieldTextureSize, maxWaterBowls, maxDragWorldSpeed, velocityWorldScale } from "../config";
import { basinMaskChunk, gaussianChunk } from "./shader-chunks";
import type { SharedWaterUniforms } from "./uniforms";
import { sampleBowlWaterContact, type BowlWaterContact } from "../bowls/profile";
import type { BowlBody } from "../bowls/types";

// The bowl contact field (meniscus height, signed pressure, meniscus, footprint).
// Each bowl is splatted as one compact instanced quad, blended additively
// into the target. Moving contact pressure drives the wave solver. This keeps
// the cost proportional to the area bowls actually influence instead of
// evaluating every bowl at every texel (100 bowls x 384^2 texels).
export type BowlField = {
  update: (bowls: BowlBody[]) => void;
  dispose: () => void;
};

type BowlFieldDeps = {
  renderer: THREE.WebGLRenderer;
  uniforms: SharedWaterUniforms;
};

const bowlFieldOptions = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

const bowlFieldVertexShader = `
  attribute vec4 aBowlData;
  attribute vec3 aBowlVelocity;

  uniform vec4 uSimWorld;

  varying vec2 vWorld;
  varying vec4 vBowlData;
  varying vec2 vDirection;
  varying vec2 vSplatUv;
  varying float vContactVisibility;


  void main() {
    vec2 center = aBowlData.xy;
    float radius = max(aBowlData.z, 0.001);
    float speed = length(aBowlVelocity.xy);
    vec2 direction = speed > 0.0001 ? aBowlVelocity.xy / speed : vec2(1.0, 0.0);
    // Preserve the source quad's counterclockwise winding in simulation UV.
    vec2 tangent = vec2(direction.y, -direction.x);

    // Contact pressure is compact. The simulation carries the detached wake,
    // so a moving bowl does not need a long, overlapping trail-shaped splat.
    float extent = radius + 0.24;
    vec2 world = center + (direction * position.y + tangent * position.x) * extent;

    vWorld = world;
    vBowlData = aBowlData;
    vDirection = direction;
    vSplatUv = position.xy * 0.5 + 0.5;
    vContactVisibility = aBowlVelocity.z;

    vec2 simUv = (world - uSimWorld.xy) / max(uSimWorld.zw, vec2(0.001));
    gl_Position = vec4(simUv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const bowlFieldFragmentShader = `
  precision highp float;

  uniform vec4 uPoolData;

  varying vec2 vWorld;
  varying vec4 vBowlData;
  varying vec2 vDirection;
  varying vec2 vSplatUv;
  varying float vContactVisibility;

  ${gaussianChunk}
  ${basinMaskChunk}

  void main() {
    vec2 p = vWorld;
    // Finite support: fade to zero before the rasterized quad ends so the
    // slope prepass never differentiates a hard wake boundary.
    vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.06), vSplatUv)
      * (1.0 - smoothstep(vec2(0.94), vec2(1.0), vSplatUv));
    float mask = basinMask(p) * vContactVisibility * edgeFade.x * edgeFade.y;
    vec2 center = vBowlData.xy;
    float radius = vBowlData.z;
    float wakeStrength = vBowlData.w;
    vec2 direction = vDirection;
    vec2 tangent = vec2(-direction.y, direction.x);
    vec2 offset = p - center;
    float d = length(offset);
    float rimWidth = 0.036 + radius * 0.034;
    float rim = gaussianBand(d, radius, rimWidth);
    float footprint = 1.0 - smoothstep(radius - rimWidth * 0.35, radius + rimWidth * 0.20, d);
    // Opposite pressures at bow and stern redistribute the displaced water.
    // This signed dipole integrates to zero around the hull and is evaluated
    // for every moving bowl, whether driven by a pointer or by the current.
    float radialMotion = dot(offset, direction) / max(d, 0.001);
    float pressureBand = gaussianBand(d, radius, 0.065 + radius * 0.06);
    float pressure = radialMotion * pressureBand * wakeStrength * 0.012;
    gl_FragColor = vec4(rim * 0.008, pressure, rim * 0.56, footprint) * mask;
  }
`;

function createBowlSplatGeometry() {
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(2, 2);
  geometry.setIndex(quad.getIndex());
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.instanceCount = 0;

  const bowlData = new Float32Array(maxWaterBowls * 4);
  const bowlVelocity = new Float32Array(maxWaterBowls * 3);
  const bowlDataAttribute = new THREE.InstancedBufferAttribute(bowlData, 4);
  const bowlVelocityAttribute = new THREE.InstancedBufferAttribute(bowlVelocity, 3);
  bowlDataAttribute.setUsage(THREE.DynamicDrawUsage);
  bowlVelocityAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aBowlData", bowlDataAttribute);
  geometry.setAttribute("aBowlVelocity", bowlVelocityAttribute);
  return { geometry, bowlDataAttribute, bowlVelocityAttribute };
}

export function createBowlField({ renderer, uniforms }: BowlFieldDeps): BowlField {
  const target = new THREE.WebGLRenderTarget(
    bowlFieldTextureSize,
    bowlFieldTextureSize,
    bowlFieldOptions,
  );
  target.texture.name = "Basin bowl influence field";
  // The target never ping-pongs, so the composite passes can bind it once.
  uniforms.uBowlFieldMap.value = target.texture;

  const {
    geometry: splatGeometry,
    bowlDataAttribute,
    bowlVelocityAttribute,
  } = createBowlSplatGeometry();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSimWorld: uniforms.uSimWorld,
      uPoolData: uniforms.uPoolData,
    },
    vertexShader: bowlFieldVertexShader,
    fragmentShader: bowlFieldFragmentShader,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const fieldScene = new THREE.Scene();
  const fieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fieldMesh = new THREE.Mesh(splatGeometry, material);
  fieldMesh.frustumCulled = false;
  fieldScene.add(fieldMesh);

  const previousClearColor = new THREE.Color();
  const contact: BowlWaterContact = { radius: 0, visibility: 0 };

  return {
    update(bowls: BowlBody[]) {
      const visibleBowlCount = Math.min(bowls.length, maxWaterBowls);
      let splatCount = 0;
      for (let i = 0; i < visibleBowlCount; i += 1) {
        const bowl = bowls[i];
        sampleBowlWaterContact(bowl.radius, bowl.mesh.position.y, contact);
        if (contact.visibility <= 0.001 || contact.radius <= 0) {
          continue;
        }
        const wakeStrength = THREE.MathUtils.clamp(bowl.waterVelocity.length() * velocityWorldScale / maxDragWorldSpeed, 0, 1);
        bowlDataAttribute.array[splatCount * 4] = bowl.mesh.position.x;
        bowlDataAttribute.array[splatCount * 4 + 1] = bowl.mesh.position.z;
        bowlDataAttribute.array[splatCount * 4 + 2] = contact.radius;
        bowlDataAttribute.array[splatCount * 4 + 3] = wakeStrength;
        bowlVelocityAttribute.array[splatCount * 3] = bowl.waterVelocity.x;
        bowlVelocityAttribute.array[splatCount * 3 + 1] = bowl.waterVelocity.y;
        bowlVelocityAttribute.array[splatCount * 3 + 2] = contact.visibility;
        splatCount += 1;
      }
      bowlDataAttribute.needsUpdate = true;
      bowlVelocityAttribute.needsUpdate = true;
      splatGeometry.instanceCount = splatCount;

      renderer.getClearColor(previousClearColor);
      const previousClearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
      renderer.render(fieldScene, fieldCamera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
    },

    dispose() {
      target.dispose();
      material.dispose();
      splatGeometry.dispose();
    },
  };
}
