import { noisePeriod } from "./noise-texture";

// Shared GLSL fragments, interpolated into the shader sources that need them.
//
// Every pass over the basin — the GPGPU simulation, the interaction and bowl
// fields, the wave-state prepass, the water surface, the basin floor, the bowl
// reflections — reconstructs the same handful of primitives. They used to be
// transcribed per file, and the copies had drifted. These are the one copy.
//
// A chunk declares functions only. The uniforms it reads (uPoolData, uSimWorld,
// uNoiseMap) stay declared by the shader that includes it, so a shader still
// states its own interface.

export const basinConstantsChunk = `
  const float BASIN_TAU = 6.28318530718;
`;

// exp(-x^2) falloff, the shape every envelope in the wave shaders is built
// from. Written as a multiply rather than pow(value, 2.0): pow() is undefined
// for a negative base in GLSL, and these arguments are routinely signed (an
// offset across a wake, a signed distance to a wavefront).
export const gaussianChunk = `
  float expFalloff(float value, float width) {
    float scaled = value / max(width, 0.001);
    return exp(-(scaled * scaled));
  }

  float gaussianBand(float value, float center, float width) {
    return expFalloff(value - center, width);
  }
`;

// The basin's soft circular boundary. uPoolData = (centerX, centerZ, radius,
// edgeSoftness); the mask reaches 0 at the rim so nothing spills onto the wood.
export const basinMaskChunk = `
  float basinMask(vec2 p) {
    float radius = max(uPoolData.z, 0.001);
    float softness = clamp(uPoolData.w * 0.22, 0.060, 0.180);
    float d = length(p - uPoolData.xy);
    return 1.0 - smoothstep(radius - softness, radius, d);
  }
`;

// World XZ to simulation-texture UV. uSimWorld = (originX, originZ, width,
// depth) of the square the simulation, interaction, and wave-state targets
// cover.
export const simulationUvChunk = `
  vec2 simulationUv(vec2 p) {
    return (p - uSimWorld.xy) / max(uSimWorld.zw, vec2(0.001));
  }
`;

// Value noise read from the baked tiling texture (see noise-texture.ts for why
// it is a texture and not ALU). This is the only value noise left in the piece;
// the ALU sin-hash version it replaced is gone.
//
// The texture repeats every `noisePeriod` argument units. Every caller either
// feeds it world-space positions (well inside one period for any basin size) or
// a slowly advecting coordinate, where the repeat reads as the noise field
// drifting past rather than as a visible tile.
export const valueNoiseChunk = `
  float valueNoise(vec2 p) {
    return texture2D(uNoiseMap, p * ${(1 / noisePeriod).toFixed(6)}).r;
  }
`;
