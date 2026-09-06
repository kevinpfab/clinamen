import { describe, expect, test } from "bun:test";
import { waterPlaneY } from "../src/config";
import {
  createBowlShellProfile,
  getBowlPlaneY,
  getBowlRimY,
  sampleBowlWaterContact,
} from "../src/bowls/profile";

describe("bowl waterline", () => {
  test("scaled shells agree with rim placement and intersect water at rest", () => {
    const unit = createBowlShellProfile(1);
    for (const radius of [0.18, 0.25, 0.375, 0.5, 0.7]) {
      const profile = createBowlShellProfile(radius);
      const origin = getBowlPlaneY(radius);
      expect(getBowlRimY(radius)).toBeCloseTo(unit.rimY * radius, 12);
      expect(Math.min(...profile.outer.map((point) => origin + point.y))).toBeLessThan(waterPlaneY);
      expect(origin + profile.rimY).toBeGreaterThan(waterPlaneY);
      const contact = sampleBowlWaterContact(radius, origin, { radius: 0, visibility: 0 });
      expect(contact.visibility).toBe(1);
      expect(contact.radius).toBeGreaterThan(0);
      expect(contact.radius).toBeLessThan(radius);

      // Independently intersect the long lower wall segment: the field must
      // touch the actual rendered hull, not the maximum rim radius.
      const a = profile.outer[2];
      const b = profile.outer[3];
      const wallY = a.y + (b.y - a.y) * (contact.radius - a.x) / (b.x - a.x);
      expect(origin + wallY).toBeCloseTo(waterPlaneY, 12);
    }
  });

  test("submerged and lifted bowls leave no dry footprint", () => {
    for (const radius of [0.25, 0.5]) {
      for (const y of [getBowlPlaneY(radius, 0), waterPlaneY + 0.1]) {
        const contact = sampleBowlWaterContact(radius, y, { radius: 1, visibility: 1 });
        expect(contact).toEqual({ radius: 0, visibility: 0 });
      }
    }
  });

  test("contact fades in continuously only after the crown breaks the surface", () => {
    const radius = 0.25;
    const crownAtWater = waterPlaneY - getBowlRimY(radius);
    const contact = { radius: 0, visibility: 0 };
    sampleBowlWaterContact(radius, crownAtWater - 0.001, contact);
    expect(contact.visibility).toBe(0);
    sampleBowlWaterContact(radius, crownAtWater + 1e-6, contact);
    expect(contact.visibility).toBeGreaterThan(0);
    expect(contact.visibility).toBeLessThan(1e-6);
    sampleBowlWaterContact(radius, crownAtWater + 0.02, contact);
    expect(contact.visibility).toBe(1);
    expect(contact.radius).toBeGreaterThan(radius * 0.9);
  });
});
