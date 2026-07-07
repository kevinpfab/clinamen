import * as THREE from "three";
import { bowlImpactRimInnerRadius, bowlLatheSegments, bowlWallStraightness } from "../config";
import type { BowlShellProfile } from "./types";
import { getBowlHeight } from "./tuning";

// Shared bowl profiles. The render path instances these unit-radius geometries
// and applies per-bowl transforms instead of allocating geometry per bowl.

// How far the hero's intro flare band curls over the outside of the rounded
// rim, as a fraction of bowl height (the lip's outer base sits at ~1.0). Just
// below 1.0 wraps the rim's outer edge without running down the main bowl.
const heroRimOuterDrape = 0.96;

export function getBowlRimRoundness(radius: number) {
  return Math.max(0.018, radius * 0.030);
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

// Height of the bowl's inner/outer wall at a given radius, walking a descending
// profile polyline. Used to seat the hero rim band on the real wall surface.
function sampleWallHeight(wall: THREE.Vector2[], radius: number) {
  for (let i = 0; i < wall.length - 1; i += 1) {
    const a = wall[i];
    const b = wall[i + 1];
    if (radius <= a.x && radius >= b.x) {
      return THREE.MathUtils.lerp(a.y, b.y, (radius - a.x) / (b.x - a.x));
    }
  }
  return wall[wall.length - 1].y;
}

// Push each profile point along its outward surface normal. A flat vertical
// lift barely clears the near-vertical rim walls, so the band still z-fights
// the shell; a normal offset floats it a consistent margin proud of the
// porcelain the whole way round the lip. The arch runs inner edge -> crown ->
// outer edge, so the (-tangent.y, tangent.x) perpendicular consistently points
// to the air side.
function offsetAlongNormals(points: THREE.Vector2[], margin: number) {
  const last = points.length - 1;
  return points.map((point, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(last, i + 1)];
    const tangent = new THREE.Vector2(next.x - prev.x, next.y - prev.y);
    if (tangent.lengthSq() < 1e-8) {
      return point.clone();
    }
    tangent.normalize();
    return new THREE.Vector2(
      point.x - tangent.y * margin,
      point.y + tangent.x * margin,
    );
  });
}

// A high-resolution lathe band that traces the bowl's actual rounded rim: up
// the inner wall from the impulse inner radius, over the crowned lip, and down
// to the pool-facing edge. Unlike the shared flat RingGeometry, this drapes the
// hero's intro flare onto the true rim contour. Built at unit radius so the
// resonance shader's radius math (which reads raw position.xz) stays in the
// same 0..1 space as the instanced rim.
export function createHeroBowlRimGeometry(segments: number) {
  const profile = createBowlShellProfile(1);
  const { inner, outer } = profile;

  // Rim lip arc, as authored in the shell profile: the last three `outer`
  // points are rimLip(0 / 0.25 / 0.5), the first two `inner` points are
  // rimLip(0.75 / 1).
  const lipInner = inner[1]; // rimLip(1): inner edge of the lip
  const lipInnerMid = inner[0]; // rimLip(0.75)
  const lipPeak = outer[outer.length - 1]; // rimLip(0.5): crown
  const lipOuterMid = outer[outer.length - 2]; // rimLip(0.25)
  const lipOuter = outer[outer.length - 3]; // rimLip(0): outer base of the lip
  const outerWall = outer[outer.length - 4]; // widest bulge, just below the lip

  // Seat the inner edge on the real inner wall at the impulse inner radius.
  const innerWall = inner.slice(1);
  const innerEdgeY = sampleWallHeight(innerWall, bowlImpactRimInnerRadius);

  // Curl the outer edge just over the outside of the rounded lip, down toward
  // the top of the outer wall but no further, so the flare drapes the rim and
  // not the main bowl body.
  const outerCurlY = getBowlHeight(1) * heroRimOuterDrape;
  const curlT = (outerCurlY - lipOuter.y) / (outerWall.y - lipOuter.y);
  const outerCurlX = THREE.MathUtils.lerp(lipOuter.x, outerWall.x, curlT);

  // Stored peak-relative so placement can anchor the crown at getBowlRimY,
  // matching the instanced rim's plane.
  const peakY = profile.rimY;
  const at = (point: THREE.Vector2) =>
    new THREE.Vector2(point.x, point.y - peakY);

  const surface = [
    at(new THREE.Vector2(bowlImpactRimInnerRadius, innerEdgeY)),
    at(lipInner),
    at(lipInnerMid),
    at(lipPeak),
    at(lipOuterMid),
    at(lipOuter),
    at(new THREE.Vector2(outerCurlX, outerCurlY)),
  ];

  // Float the band clear of the porcelain along the surface normal so the
  // additive flare never z-fights the shell it hugs.
  const band = offsetAlongNormals(surface, getBowlRimRoundness(1) * 0.9);
  return new THREE.LatheGeometry(band, segments);
}

export function createInstancedBowlShellGeometry() {
  return new THREE.LatheGeometry(createBowlShellProfile(1).full, bowlLatheSegments);
}

export function createInstancedBowlReflectionGeometry() {
  const geometry = new THREE.LatheGeometry(createBowlShellProfile(1).outer, bowlLatheSegments);
  geometry.scale(1, -1, 1);
  return geometry;
}

export function createInstancedBowlRimGeometry() {
  const geometry = new THREE.RingGeometry(bowlImpactRimInnerRadius, 1.0, bowlLatheSegments, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
