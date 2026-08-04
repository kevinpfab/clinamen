import { waterSurfacePadding } from "../config";
import { world } from "../settings";

// The water surface is a circle slightly larger than the world bounds. Every
// system that needs the basin radius derives it from here so the pool, floor,
// bowls, and simulation all agree on a single value.
export function getWaterSurfaceRadius() {
  return world.width / 2 + waterSurfacePadding / 2;
}
