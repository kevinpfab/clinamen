import * as THREE from "three";
import { circularPoolSegments } from "../config";
import type { SharedWaterUniforms } from "./uniforms";
import {
  simulationUvChunk,
} from "./shader-chunks";

// The brilliant-blue water surface: a circular plane driven by a custom shader
// that reads the simulation, bowl, and precomputed interaction fields.
export type WaterSurface = {
  setRadius: (radius: number) => void;
  dispose: () => void;
};

type WaterSurfaceDeps = {
  scene: THREE.Scene;
  uniforms: SharedWaterUniforms;
};

const waterVertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

const waterFragmentShader = `
    precision highp float;
    uniform float uTime;
    uniform float uSceneDim;
    uniform sampler2D uWaveDetailMap;
    uniform sampler2D uWaveDerivedMap;
    uniform vec4 uSimWorld;
    uniform vec4 uPoolData;
    varying vec3 vWorldPosition;

    ${simulationUvChunk}

    // An inexpensive, stationary studio environment. A broad overhead source
    // gives moving slopes something coherent to reflect. Unlike painted crest
    // highlights, its bright and dark sides change with the viewing direction.
    vec3 reflectedRoom(vec3 ray) {
      vec3 room = mix(vec3(0.19, 0.25, 0.28), vec3(0.48, 0.57, 0.60),
        smoothstep(0.0, 0.8, ray.y));
      float softbox = pow(max(dot(ray, normalize(vec3(-0.18, 0.60, -0.78))), 0.0), 90.0);
      float fill = pow(max(dot(ray, normalize(vec3(0.82, 0.48, 0.30))), 0.0), 10.0);
      return room + vec3(1.0, 0.96, 0.87) * softbox * 5.0
        + vec3(0.66, 0.78, 0.86) * fill * 0.55;
    }

    void main() {
      vec2 p = vWorldPosition.xz;
      vec2 uv = clamp(simulationUv(p), 0.001, 0.999);
      vec4 detail = texture2D(uWaveDetailMap, uv);
      vec4 derived = texture2D(uWaveDerivedMap, uv);
      // Barely perceptible ambient motion; the interaction field carries the
      // readable waves. No high-frequency noise that swims over a still bowl.
      vec2 ambient = vec2(0.003 * cos(dot(p, vec2(1.7, 0.8)) - uTime * 0.7),
                          0.002 * cos(dot(p, vec2(-0.6, 2.1)) - uTime * 0.9));
      vec3 normal = normalize(vec3(derived.x + ambient.x, 1.0, derived.y + ambient.y));
      vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
      float nv = clamp(dot(normal, viewDirection), 0.0, 1.0);
      float fresnel = 0.020 + 0.980 * pow(1.0 - nv, 5.0);
      vec3 reflected = reflectedRoom(reflect(-viewDirection, normal));
      float radial = length(p - uPoolData.xy) / max(uPoolData.z, 0.001);
      float edge = smoothstep(0.66, 1.0, radial);
      vec3 transmission = mix(vec3(0.035, 0.385, 0.515), vec3(0.025, 0.285, 0.365), edge * 0.40);
      // Premultiplied optical balance expressed in straight-alpha form:
      // reflection increases as transmission decreases at grazing angles.
      float absorption = 0.66;
      float alpha = absorption + fresnel * (1.0 - absorption);
      vec3 color = (transmission * absorption * (1.0 - fresnel) + reflected * fresnel) / alpha;
      // Only genuinely agitated water gets a little foam; ordinary ripples
      // remain transparent and are described by their normals.
      float foam = smoothstep(0.22, 0.75, derived.w) * 0.12;
      color = mix(color, vec3(0.85, 0.91, 0.90), foam);
      alpha *= 1.0 - clamp(detail.z, 0.0, 1.0);
      gl_FragColor = vec4(color * uSceneDim, alpha);
    }
`;

export function createWaterSurface({ scene, uniforms }: WaterSurfaceDeps): WaterSurface {
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, circularPoolSegments), material);
  mesh.name = "Basin water surface";
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  scene.add(mesh);

  return {
    setRadius(radius: number) {
      mesh.scale.set(radius, radius, 1);
    },

    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
