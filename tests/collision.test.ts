import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BOWL_COLLISION_SETTINGS,
  getBowlPairKey,
  resolveBowlContacts,
  type BowlCollisionBody,
  type BowlContactState,
} from "../src/physics/collision";

function body(overrides: Partial<BowlCollisionBody>): BowlCollisionBody {
  return {
    id: 0,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    massRadius: 0.5,
    contactRadius: 0.5,
    inverseMass: 1,
    ...overrides,
  };
}

describe("bowl collision contacts", () => {
  test("pair keys are numeric and independent of id order", () => {
    const forward = getBowlPairKey(3, 17);
    const reverse = getBowlPairKey(17, 3);

    expect(typeof forward).toBe("number");
    expect(reverse).toBe(forward);
    expect(getBowlPairKey(3, 18)).not.toBe(forward);
  });

  test("existing contact state records are updated in place", () => {
    const key = getBowlPairKey(0, 1);
    const state: BowlContactState = { lastSeenAt: 1 };
    const contactStates = new Map<number, BowlContactState>([[key, state]]);
    const bodies = [
      body({ id: 0, x: 0, vx: 0.01 }),
      body({ id: 1, x: 0.8, vx: -0.01 }),
    ];

    resolveBowlContacts(bodies, contactStates, 2, {
      ...DEFAULT_BOWL_COLLISION_SETTINGS,
      iterations: 1,
    });

    expect(contactStates.get(key)).toBe(state);
    expect(state.lastSeenAt).toBe(2);
  });
});
