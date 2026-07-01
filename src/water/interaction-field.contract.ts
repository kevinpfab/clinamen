import * as THREE from "three";
import {
  interactionFieldMaterial,
  interactionFieldQuad,
  interactionFieldTarget,
  updateInteractionField,
} from "./interaction-field";
import { waterUniforms } from "./uniforms";

const target: THREE.WebGLRenderTarget = interactionFieldTarget;
const material: THREE.ShaderMaterial = interactionFieldMaterial;
const quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> = interactionFieldQuad;
const update: () => void = updateInteractionField;
const texture: THREE.Texture | null = waterUniforms.uInteractionFieldMap.value;

void target;
void material;
void quad;
void update;
void texture;
