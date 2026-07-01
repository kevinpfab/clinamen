import { describe, expect, test } from "bun:test";
import { WaterImpulseQueue } from "../src/water/impulses";

describe("WaterImpulseQueue", () => {
  test("keeps the newest impulses when capacity is exceeded", () => {
    const queue = new WaterImpulseQueue(3);

    queue.enqueue(1, 0, 0.2, 0.1);
    queue.enqueue(2, 0, 0.2, 0.2);
    queue.enqueue(3, 0, 0.2, 0.3);
    queue.enqueue(4, 0, 0.2, 0.4);

    expect(queue.count).toBe(3);
    expect(Array.from(queue.entries()).map((impulse) => impulse.x)).toEqual([2, 3, 4]);
  });

  test("clear removes queued impulses before the next simulation step", () => {
    const queue = new WaterImpulseQueue(4);

    queue.enqueue(1, 2, 0.3, 0.4);
    queue.clear();

    expect(queue.count).toBe(0);
    expect(Array.from(queue.entries())).toEqual([]);
  });
});
