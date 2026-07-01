import * as THREE from "three";
import { maxFlowJets, maxRipples, waterInteractionFieldSize } from "../config";
import { renderer } from "../core/stage";
import { waterUniforms } from "./uniforms";

const interactionFieldOptions = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

export const interactionFieldTarget = new THREE.WebGLRenderTarget(
  waterInteractionFieldSize,
  waterInteractionFieldSize,
  interactionFieldOptions,
);
interactionFieldTarget.texture.name = "Basin water interaction field";
waterUniforms.uInteractionFieldMap.value = interactionFieldTarget.texture;

const interactionFieldUniforms: Record<string, THREE.IUniform> = {
  uTime: waterUniforms.uTime,
  uSimWorld: waterUniforms.uSimWorld,
  uPoolData: waterUniforms.uPoolData,
  uRippleCenters: waterUniforms.uRippleCenters,
  uRippleData: waterUniforms.uRippleData,
  uRippleCount: waterUniforms.uRippleCount,
  uFlowJetData: waterUniforms.uFlowJetData,
  uFlowJetParams: waterUniforms.uFlowJetParams,
  uFlowJetCount: waterUniforms.uFlowJetCount,
};

export const interactionFieldMaterial = new THREE.ShaderMaterial({
  uniforms: interactionFieldUniforms,
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform vec4 uSimWorld;
    uniform vec4 uPoolData;
    uniform vec4 uRippleCenters[${maxRipples}];
    uniform vec4 uRippleData[${maxRipples}];
    uniform int uRippleCount;
    uniform vec4 uFlowJetData[${maxFlowJets}];
    uniform vec4 uFlowJetParams[${maxFlowJets}];
    uniform int uFlowJetCount;

    varying vec2 vUv;

    const float BASIN_TAU = 6.28318530718;

    float hash21(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float gaussianBand(float value, float center, float width) {
      float scaled = (value - center) / max(width, 0.001);
      return exp(-(scaled * scaled));
    }

    float basinMask(vec2 p) {
      float radius = max(uPoolData.z, 0.001);
      float softness = clamp(uPoolData.w * 0.22, 0.060, 0.180);
      float d = length(p - uPoolData.xy);
      return 1.0 - smoothstep(radius - softness, radius, d);
    }

    vec4 rippleField(vec2 p) {
      float waveHeight = 0.0;
      float waveSlope = 0.0;
      float waveEnergy = 0.0;
      float contactAccent = 0.0;
      for (int i = 0; i < ${maxRipples}; i++) {
        if (i >= uRippleCount) {
          break;
        }
        vec2 center = uRippleCenters[i].xy;
        float age = uRippleData[i].x;
        float lifetime = max(uRippleData[i].y, 0.001);
        float strength = uRippleData[i].z;
        float shape = uRippleData[i].w;
        vec2 direction = uRippleCenters[i].zw;
        float directionLength = length(direction);
        direction = directionLength > 0.001 ? direction / directionLength : vec2(1.0, 0.0);
        vec2 tangent = vec2(-direction.y, direction.x);
        vec2 offset = p - center;
        float progress = clamp(age / lifetime, 0.0, 1.0);
        float ageGate = smoothstep(0.0, 0.055, age);

        if (shape > 0.5) {
          float motion = clamp(directionLength - 1.0, 0.0, 1.0);
          float ahead = dot(offset, direction);
          float behind = -ahead;
          float across = dot(offset, tangent);
          float activeBehind = max(behind, 0.0);
          float radiusHint = 0.24 + strength * 0.42 + motion * 0.22;
          float travel = age * (0.92 + strength * 0.26 + motion * 0.34);
          float packetWidth = radiusHint * (0.82 + motion * 0.24) + progress * 0.36;
          float packetScaled = (activeBehind - travel) / max(packetWidth, 0.001);
          float wavePacket = exp(-(packetScaled * packetScaled));
          float fade = pow(1.0 - progress, 1.70) * ageGate;
          float contactFade = pow(1.0 - progress, 3.20) * ageGate;
          float distanceDamp = inversesqrt(1.0 + activeBehind * 0.38 + abs(across) * 0.18);

          float wakeAngle = mix(0.36, 0.52, motion);
          float divergentWidth = radiusHint * (0.24 + progress * 0.32) + activeBehind * 0.018;
          float divergentLine = abs(across) - activeBehind * wakeAngle;
          float divergentScaled = divergentLine / max(divergentWidth, 0.001);
          float divergentEnvelope = exp(-(divergentScaled * divergentScaled));
          divergentEnvelope *= smoothstep(0.0, radiusHint * 0.42 + 0.055, behind);
          divergentEnvelope *= exp(-activeBehind / (3.00 + motion * 1.55));
          divergentEnvelope *= wavePacket;
          float divergentPhase = activeBehind * (9.4 + motion * 4.6) - age * (8.2 + motion * 5.0) + abs(across) * 0.72;
          float divergentWave = sin(divergentPhase) * divergentEnvelope;

          float transverseWidth = radiusHint * (1.18 + motion * 0.48) + activeBehind * 0.19;
          float transverseScaled = across / max(transverseWidth, 0.001);
          float transverseEnvelope = exp(-(transverseScaled * transverseScaled));
          transverseEnvelope *= smoothstep(0.0, radiusHint * 0.55 + 0.070, behind);
          transverseEnvelope *= exp(-activeBehind / (2.30 + motion * 1.12));
          transverseEnvelope *= wavePacket;
          float transversePhase = activeBehind * (7.1 + motion * 3.1) - age * (6.8 + motion * 4.1);
          float transverseWave = sin(transversePhase) * transverseEnvelope;

          float bowCrest = gaussianBand(ahead, radiusHint * 0.30, radiusHint * (0.54 + motion * 0.18));
          float bowAcross = across / (radiusHint * (1.75 + motion * 0.46));
          bowCrest *= exp(-(bowAcross * bowAcross));
          bowCrest *= 1.0 - smoothstep(radiusHint * 2.8, radiusHint * 5.2, length(offset));

          float sternTrough = gaussianBand(behind, radiusHint * 0.62, radiusHint * (0.76 + motion * 0.22));
          float sternAcross = across / (radiusHint * (1.24 + motion * 0.32));
          sternTrough *= exp(-(sternAcross * sternAcross));

          float shoulder = gaussianBand(abs(across), radiusHint * (0.72 + motion * 0.22), radiusHint * 0.34);
          shoulder *= gaussianBand(ahead, radiusHint * 0.02, radiusHint * (1.10 + motion * 0.32));

          float amplitude = strength * fade * (0.34 + motion * 0.24) * distanceDamp;
          float contactAmplitude = strength * contactFade * (0.28 + motion * 0.16);
          float localHeight = (divergentWave * 0.54 + transverseWave * 0.32) * amplitude
            + (bowCrest * 0.34 + shoulder * 0.10 - sternTrough * 0.24) * contactAmplitude;
          float localEnergy = (
            abs(divergentWave) * 1.05
            + abs(transverseWave) * 0.72
          ) * amplitude + (
            bowCrest * 0.78
            + sternTrough * 0.54
            + shoulder * 0.26
          ) * contactAmplitude;

          waveHeight += localHeight;
          waveSlope += localEnergy * (2.40 + motion * 0.70);
          waveEnergy += localEnergy * 0.82;
          contactAccent += (bowCrest + shoulder * 0.40) * strength * contactFade * 0.28;
          continue;
        }

        float d = length(offset);
        float angle = atan(offset.y, offset.x);
        vec2 radialDirection = d > 0.001 ? offset / d : direction;
        float alongImpact = dot(offset, direction);
        float acrossImpact = dot(offset, tangent);
        float organic = sin(angle * 4.0 + age * 0.85 + center.x) * 0.030;
        organic += sin(angle * 7.0 - age * 1.10 + center.y) * 0.020;
        organic += (valueNoise(offset * 0.74 + center * 0.13 + vec2(age * 0.08, -age * 0.05)) - 0.5) * 0.038;

        float waveSpeed = 1.08 + strength * 0.42;
        float travel = age * waveSpeed;
        float early = 1.0 - smoothstep(0.0, 0.26, progress);
        float forward = dot(radialDirection, direction);
        float directionalSpread = mix(
          1.0,
          0.82 + 0.30 * abs(dot(radialDirection, tangent)) + 0.20 * max(forward, 0.0),
          early
        );
        float spread = inversesqrt(1.0 + d * 0.78);
        float fade = pow(1.0 - progress, 1.62) * ageGate * spread;
        float amplitude = strength * fade * 1.04;
        float compressionAlong = alongImpact / 0.075;
        float compressionAcross = acrossImpact / 0.46;
        float compression = exp(-(compressionAlong * compressionAlong)) * exp(-(compressionAcross * compressionAcross));
        compression *= early * early * smoothstep(0.0, 0.035, age) * strength;

        float signedDistance = d - travel + organic;
        float packetWidth = 0.130 + progress * 0.220 + strength * 0.036;
        float packetScaled = signedDistance / packetWidth;
        float packet = exp(-(packetScaled * packetScaled));
        float crestScaled = signedDistance / (packetWidth * 0.42);
        float troughScaled = (signedDistance + packetWidth * 0.64) / (packetWidth * 0.58);
        float recoveryScaled = (signedDistance + packetWidth * 1.34) / (packetWidth * 0.82);
        float tailScaled = (signedDistance + packetWidth * 2.20) / (packetWidth * 1.35);
        float crest = exp(-(crestScaled * crestScaled));
        float trough = exp(-(troughScaled * troughScaled));
        float recoveryCrest = exp(-(recoveryScaled * recoveryScaled));
        float tail = exp(-(tailScaled * tailScaled));
        float carrierFrequency = mix(28.0, 18.0, progress);
        float carrier = sin(signedDistance * carrierFrequency + organic * 10.0);
        float fineRipple = carrier * packet * (0.13 + strength * 0.08);
        float pulse = (
          crest * 1.05
          - trough * 0.82
          + recoveryCrest * 0.42
          - tail * 0.12
          + fineRipple
        ) * directionalSpread;
        float localSlope = (
          crest * 1.05
          + trough * 0.82
          + recoveryCrest * 0.42
          + tail * 0.12
          + abs(carrier) * packet * 0.18
        ) / packetWidth;
        float frontAccent = (
          crest * 0.80
          + trough * 0.36
          + recoveryCrest * 0.20
          + abs(carrier) * packet * 0.10
        ) * directionalSpread * amplitude;

        waveHeight += pulse * amplitude;
        waveSlope += localSlope * amplitude * 0.66;
        waveEnergy += (crest + trough * 0.74 + recoveryCrest * 0.38 + tail * 0.18) * amplitude * 1.10;

        waveHeight += compression * 0.024;
        waveEnergy += compression * 0.26 + frontAccent * 0.56;
        waveSlope += compression * 0.28;
        contactAccent += compression * 0.28 + frontAccent * 1.18;
      }

      return vec4(waveHeight, waveSlope, waveEnergy, contactAccent);
    }

    float flowChannelField(vec2 p) {
      float energy = 0.0;

      for (int i = 0; i < ${maxFlowJets}; i++) {
        if (i >= uFlowJetCount) {
          break;
        }

        vec4 jet = uFlowJetData[i];
        vec4 params = uFlowJetParams[i];
        vec2 source = jet.xy;
        vec2 direction = length(jet.zw) > 0.001 ? normalize(jet.zw) : vec2(1.0, 0.0);
        vec2 tangent = vec2(-direction.y, direction.x);
        float radius = max(params.x, 0.001);
        float strength = params.y;
        float phase = params.w;
        vec2 offset = p - source;
        float along = dot(offset, direction);
        float across = dot(offset, tangent);
        float d = length(offset);
        float nozzleScaled = d / (radius * 1.36);
        float nozzle = exp(-(nozzleScaled * nozzleScaled));
        float downstream = smoothstep(-radius * 0.35, radius * 0.80, along);
        float plumeAcross = across / (radius * 2.75);
        float plume = downstream
          * exp(-(plumeAcross * plumeAcross))
          * exp(-max(along, 0.0) / (radius * 8.8));
        float advected = along / radius * 0.42 - uTime * 0.62 + phase;
        float axialNoise = valueNoise(vec2(advected, across / radius * 1.75 + phase));
        float lane = sin((across / radius * 0.52 + axialNoise * 0.34 + phase * 0.17) * BASIN_TAU) * 0.5 + 0.5;
        float centerScaled = across / (radius * 0.74);
        float sideScaled = (abs(across) - radius * 1.36) / (radius * 0.56);
        float centerThread = exp(-(centerScaled * centerScaled));
        float sideThread = exp(-(sideScaled * sideScaled));
        float downstreamTexture = 0.48 + centerThread * 0.22 + sideThread * 0.16 + lane * 0.12 + axialNoise * 0.10;
        float pulse = sin((advected * 0.34 + phase) * BASIN_TAU) * 0.5 + 0.5;
        energy += (nozzle * 0.56 + plume * (downstreamTexture + pulse * 0.035)) * strength * 19.0;
      }

      return clamp(energy, 0.0, 1.35);
    }

    vec3 flowRippleField(vec2 p) {
      float waveHeight = 0.0;
      float waveSlope = 0.0;
      float waveEnergy = 0.0;

      for (int i = 0; i < ${maxFlowJets}; i++) {
        if (i >= uFlowJetCount) {
          break;
        }

        vec4 jet = uFlowJetData[i];
        vec4 params = uFlowJetParams[i];
        vec2 source = jet.xy;
        vec2 direction = length(jet.zw) > 0.001 ? normalize(jet.zw) : vec2(1.0, 0.0);
        vec2 tangent = vec2(-direction.y, direction.x);
        float radius = max(params.x, 0.001);
        float strength = params.y;
        float phase = params.w;
        vec2 offset = p - source;
        float along = dot(offset, direction);
        float across = dot(offset, tangent);
        float downstream = smoothstep(-radius * 0.16, radius * 0.60, along);
        float activeAlong = max(along, 0.0);
        float lateralSpread = radius * (0.86 + activeAlong * 0.085);
        float centerScaled = across / max(lateralSpread, 0.001);
        float centerEnvelope = downstream
          * exp(-(centerScaled * centerScaled))
          * exp(-activeAlong / (radius * 7.8));
        float shoulderDistance = abs(across) - radius * (0.72 + activeAlong * 0.022);
        float shoulderScaled = shoulderDistance / (radius * 0.38 + activeAlong * 0.014);
        float shoulderEnvelope = downstream
          * exp(-(shoulderScaled * shoulderScaled))
          * exp(-activeAlong / (radius * 6.2));
        float nozzleScaled = length(offset) / (radius * 1.18);
        float nozzle = exp(-(nozzleScaled * nozzleScaled));
        float nozzlePulse = sin(uTime * 2.35 + phase * 1.37) * 0.5 + 0.5;
        float centerPhase = activeAlong / radius * 3.10 - uTime * 1.86 + phase * 1.71;
        float shoulderPhase = activeAlong / radius * 5.20 - uTime * 2.42 + abs(across) / radius * 0.78 + phase;
        float crossRipple = sin((across / radius) * 2.20 + activeAlong / radius * 0.48 - uTime * 1.18 + phase);
        float force = strength * 30.0;
        float centerWave = sin(centerPhase) * centerEnvelope;
        float shoulderWave = sin(shoulderPhase) * shoulderEnvelope;
        float turbulentThread = crossRipple * centerEnvelope * (0.20 + nozzlePulse * 0.12);

        waveHeight += (
          centerWave * 0.052
          + shoulderWave * 0.026
          + turbulentThread * 0.017
          + nozzle * (0.021 + nozzlePulse * 0.016)
        ) * force;
        waveSlope += (
          abs(centerWave) * 0.44
          + abs(shoulderWave) * 0.34
          + centerEnvelope * 0.120
          + shoulderEnvelope * 0.150
          + nozzle * 0.34
        ) * force;
        waveEnergy += (
          centerEnvelope * 0.32
          + shoulderEnvelope * 0.26
          + nozzle * (0.48 + nozzlePulse * 0.18)
        ) * force;
      }

      return vec3(waveHeight, waveSlope, waveEnergy);
    }

    void main() {
      vec2 p = uSimWorld.xy + vUv * uSimWorld.zw;
      float mask = basinMask(p);
      if (mask <= 0.001) {
        gl_FragColor = vec4(0.0);
        return;
      }

      vec4 ripple = rippleField(p);
      float flowChannel = flowChannelField(p);
      vec3 flowWake = flowRippleField(p);

      gl_FragColor = vec4(
        ripple.x * 0.66 + flowWake.x * 0.84 + flowChannel * 0.0035,
        ripple.y * 0.44 + flowWake.y * 0.78 + flowChannel * 0.040,
        ripple.z * 0.66 + flowWake.z * 0.86 + flowChannel * 0.072,
        ripple.w * 1.24 + flowChannel
      ) * mask;
    }
  `,
});

const interactionFieldScene = new THREE.Scene();
const interactionFieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
export const interactionFieldQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  interactionFieldMaterial,
);
interactionFieldScene.add(interactionFieldQuad);

export function updateInteractionField() {
  renderer.setRenderTarget(interactionFieldTarget);
  renderer.render(interactionFieldScene, interactionFieldCamera);
  renderer.setRenderTarget(null);
  waterUniforms.uInteractionFieldMap.value = interactionFieldTarget.texture;
}

export function disposeInteractionField() {
  interactionFieldTarget.dispose();
  interactionFieldMaterial.dispose();
  interactionFieldQuad.geometry.dispose();
}
