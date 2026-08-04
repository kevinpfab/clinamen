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

  // The broadphase rejects pairs on squared distance before measuring them, so
  // the reject radius has to stay wide enough to cover the release band.
  test("a separated pair inside the release band stays in contact", () => {
    const key = getBowlPairKey(0, 1);
    const state: BowlContactState = { lastSeenAt: 1 };
    const contactStates = new Map<number, BowlContactState>([[key, state]]);
    const bodies = [body({ id: 0, x: 0 }), body({ id: 1, x: 1.03 })];

    resolveBowlContacts(bodies, contactStates, 2, {
      ...DEFAULT_BOWL_COLLISION_SETTINGS,
      iterations: 1,
    });

    expect(contactStates.get(key)).toBe(state);
    expect(state.lastSeenAt).toBe(2);
  });

  test("a pair past the release band drops its contact state", () => {
    const key = getBowlPairKey(0, 1);
    const contactStates = new Map<number, BowlContactState>([[key, { lastSeenAt: 1 }]]);
    const bodies = [body({ id: 0, x: 0 }), body({ id: 1, x: 1.2 })];

    resolveBowlContacts(bodies, contactStates, 2, {
      ...DEFAULT_BOWL_COLLISION_SETTINGS,
      iterations: 1,
    });

    expect(contactStates.has(key)).toBe(false);
  });

  test("a fresh overlap emits one impact event, then goes quiet while it rests", () => {
    const contactStates = new Map<number, BowlContactState>();
    const settings = { ...DEFAULT_BOWL_COLLISION_SETTINGS, iterations: 1 };
    const bodies = [
      body({ id: 0, x: 0, vx: 0.4 }),
      body({ id: 1, x: 0.9, vx: -0.4 }),
    ];

    expect(resolveBowlContacts(bodies, contactStates, 1, settings)).toHaveLength(1);
    expect(resolveBowlContacts(bodies, contactStates, 2, settings)).toHaveLength(0);
  });
});
