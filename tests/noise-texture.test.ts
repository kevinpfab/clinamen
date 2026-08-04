import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createNoiseTexture, noisePeriod } from "../src/water/noise-texture";

// water/interaction-field.ts used to evaluate this sin-hash lattice in ALU. It
// now reads the baked texture like every other shader, so this pins the claim
// that made the swap safe: the texture reproduces the function it replaced.
function hash21(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function aluValueNoise(x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash21(x0, y0);
  const b = hash21(x0 + 1, y0);
  const c = hash21(x0, y0 + 1);
  const d = hash21(x0 + 1, y0 + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uy,
  );
}

const texture = createNoiseTexture();
const size = texture.image.width;
const data = texture.image.data as Uint8Array;

// What the GPU does for `texture2D(uNoiseMap, p / noisePeriod).r` with
// RepeatWrapping and LinearFilter: bilinear blend of the four nearest texel
// centers, wrapping at the edges.
function sampleNoiseTexture(x: number, y: number) {
  const texelX = (x / noisePeriod) * size - 0.5;
  const texelY = (y / noisePeriod) * size - 0.5;
  const x0 = Math.floor(texelX);
  const y0 = Math.floor(texelY);
  const fx = texelX - x0;
  const fy = texelY - y0;

  const texel = (tx: number, ty: number) => {
    const wrappedX = ((tx % size) + size) % size;
    const wrappedY = ((ty % size) + size) % size;
    return data[(wrappedY * size + wrappedX) * 4] / 255;
  };

  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(texel(x0, y0), texel(x0 + 1, y0), fx),
    THREE.MathUtils.lerp(texel(x0, y0 + 1), texel(x0 + 1, y0 + 1), fx),
    fy,
  );
}

describe("baked value noise", () => {
  test("reproduces the ALU value noise it replaced, within one period", () => {
    let worst = 0;
    let total = 0;
    let samples = 0;

    // A grid inside one period, deliberately off-lattice so it lands between
    // texels rather than on them.
    for (let i = 0; i < 160; i += 1) {
      for (let j = 0; j < 160; j += 1) {
        const x = (i / 160) * (noisePeriod - 1) + 0.037;
        const y = (j / 160) * (noisePeriod - 1) + 0.091;
        const error = Math.abs(sampleNoiseTexture(x, y) - aluValueNoise(x, y));
        worst = Math.max(worst, error);
        total += error;
        samples += 1;
      }
    }

    // 8-bit quantization plus bilinear reconstruction at 8 texels per lattice
    // cell. Both terms are far below the amplitudes the interaction field
    // scales this by (0.038 on a ripple edge, 0.10 on a jet plume).
    expect(worst).toBeLessThan(0.02);
    expect(total / samples).toBeLessThan(0.005);
  });

  test("repeats past one period, where the ALU version did not", () => {
    // The one real behavioral difference of the swap. It is invisible for the
    // interaction field's world-space arguments, which never leave a single
    // period for any basin size; the jets' advected coordinate does drift
    // through it, where the repeat reads as the noise field flowing past.
    expect(sampleNoiseTexture(1.25, 2.5)).toBeCloseTo(
      sampleNoiseTexture(1.25 + noisePeriod, 2.5),
      12,
    );
    expect(Math.abs(aluValueNoise(1.25, 2.5) - aluValueNoise(1.25 + noisePeriod, 2.5)))
      .toBeGreaterThan(0.01);
  });

  test("tiles seamlessly across the period boundary", () => {
    for (let i = 0; i < 64; i += 1) {
      const y = (i / 64) * noisePeriod;
      expect(sampleNoiseTexture(0.25, y)).toBeCloseTo(
        sampleNoiseTexture(0.25 + noisePeriod, y),
        12,
      );
      expect(sampleNoiseTexture(y, 0.25)).toBeCloseTo(
        sampleNoiseTexture(y, 0.25 + noisePeriod),
        12,
      );
    }
  });

  test("stays in the unit range the shaders assume", () => {
    for (let i = 0; i < data.length; i += 1) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(255);
    }
  });
});
