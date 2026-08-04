import * as THREE from "three";
import { pseudoRandom } from "../core/math";

// Where the bowls start.
//
// The old sampler drew a candidate point and rejected it against every bowl
// already placed, up to 180 times each — ~1.8M distance checks for 100 bowls,
// all of it synchronous before the first frame, and it still fell back to an
// unchecked center ring when the pool got crowded. The intro then ran a second,
// independent relaxation to clean up what that fallback left overlapping.
//
// This does the placement half only, in O(1) per bowl, and leaves overlaps to
// the single relaxation pass in the bowl system (physics/separation.ts) — which
// every layout needed anyway.

// The golden angle, in radians. Successive multiples never repeat a direction,
// which is what makes the scatter fill the disc evenly instead of clumping.
export const goldenAngle = 2.399963229728653;

// sqrt() of the index fraction spaces the rings for equal area, so the scatter
// is uniform over the disc rather than crowding the center. The jitter is then
// scaled to the ring spacing: enough to break up the phyllotaxis pattern, not
// so much that it re-creates the clumping the relaxation has to undo.
export function scatterBowlPosition(index: number, count: number, centerLimit: number) {
  const safeCount = Math.max(count, 1);
  const ringSpacing = 1 / Math.sqrt(safeCount);
  const radial = THREE.MathUtils.clamp(
    Math.sqrt((index + 0.5) / safeCount)
      + (pseudoRandom(index * 7.13 + 0.31) - 0.5) * ringSpacing * 0.9,
    0,
    1,
  );
  const angle = index * goldenAngle
    + (pseudoRandom(index * 3.71 + 0.87) - 0.5) * goldenAngle * 0.9;

  return {
    x: Math.cos(angle) * radial * centerLimit,
    z: Math.sin(angle) * radial * centerLimit,
  };
}
