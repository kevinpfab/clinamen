import * as THREE from "three";
import { bowlDraftHeightRatio, bowlEmergenceDepth, bowlHeightScale, bowlWallStraightness, waterPlaneY } from "../config";
import type { BowlShellProfile } from "./types";

// Geometry, placement, and water contact all use this same scalable profile.
export function getBowlHeight(radius: number) {
  return radius * bowlHeightScale;
}

export function getBowlPlaneY(radius: number, emergence = 1) {
  return waterPlaneY - getBowlHeight(radius) * bowlDraftHeightRatio
    - bowlEmergenceDepth * (1 - emergence);
}

export function getBowlRimRoundness(radius: number) {
  return radius * 0.030;
}

export function getBowlRimY(radius: number) {
  return getBowlHeight(radius) + getBowlRimRoundness(radius);
}

export function createBowlShellProfile(radius: number): BowlShellProfile {
  const height = getBowlHeight(radius);
  const rimRoundness = getBowlRimRoundness(radius);
  const wallRadius = (current: number, straighter: number) =>
    THREE.MathUtils.lerp(current, straighter, bowlWallStraightness);

  // The rim lip is a shallow arc bridging the outer and inner walls so the
  // profile never pinches into a knife edge at the top.
  const rimOuterX = radius * 0.985;
  const rimInnerX = radius * 0.940;
  const rimCenterX = (rimOuterX + rimInnerX) / 2;
  const rimHalfWidth = (rimOuterX - rimInnerX) / 2;
  const rimLip = (t: number) => {
    const angle = t * Math.PI;
    return new THREE.Vector2(
      rimCenterX + Math.cos(angle) * rimHalfWidth,
      height + Math.sin(angle) * rimRoundness,
    );
  };

  const outer = [
    new THREE.Vector2(0, height * 0.050),
    new THREE.Vector2(radius * 0.54, height * 0.035),
    new THREE.Vector2(radius * wallRadius(0.76, 0.88), height * 0.080),
    new THREE.Vector2(radius * 0.998, height * 0.880),
    rimLip(0),
    rimLip(0.25),
    rimLip(0.5),
  ];
  const inner = [
    rimLip(0.75),
    rimLip(1),
    new THREE.Vector2(radius * wallRadius(0.690, 0.800), height * 0.420),
    new THREE.Vector2(radius * 0.220, height * 0.082),
    new THREE.Vector2(0, height * 0.075),
  ];

  return {
    full: [...outer, ...inner],
    outer,
    inner,
    rimY: height + rimRoundness,
  };
}

const unitProfile = createBowlShellProfile(1);
const unitBottomY = Math.min(...unitProfile.outer.map((point) => point.y));

export type BowlWaterContact = {
  radius: number;
  visibility: number;
};

// Bowls stay upright during drift. Sample the outer hull at the water plane;
// choosing the outermost intersection also handles the curved foot and lip.
// The small fade at the crown/foot prevents contact popping at first touch.
// A caller-owned output keeps the per-bowl, per-frame path allocation-free.
export function sampleBowlWaterContact(radius: number, centerY: number, contact: BowlWaterContact) {
  contact.radius = 0;
  contact.visibility = 0;
  if (radius <= 0 || !Number.isFinite(radius) || !Number.isFinite(centerY)) {
    return contact;
  }
  const localY = (waterPlaneY - centerY) / radius;
  if (localY <= unitBottomY || localY >= unitProfile.rimY) {
    return contact;
  }
  for (let i = 0; i < unitProfile.outer.length - 1; i += 1) {
    const a = unitProfile.outer[i];
    const b = unitProfile.outer[i + 1];
    if (localY < Math.min(a.y, b.y) || localY > Math.max(a.y, b.y)) {
      continue;
    }
    const t = (localY - a.y) / (b.y - a.y);
    contact.radius = Math.max(contact.radius, THREE.MathUtils.lerp(a.x, b.x, t) * radius);
  }
  contact.visibility = THREE.MathUtils.smoothstep(unitProfile.rimY - localY, 0, 0.025)
    * THREE.MathUtils.smoothstep(localY - unitBottomY, 0, 0.015);
  return contact;
}
