import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/core/events";

type TestEvents = {
  ping: { value: number };
  pong: { value: number };
};

describe("EventBus", () => {
  test("delivers a payload to every subscriber of that type only", () => {
    const bus = new EventBus<TestEvents>();
    const pings: number[] = [];
    const pongs: number[] = [];

    bus.on("ping", ({ value }) => pings.push(value));
    bus.on("ping", ({ value }) => pings.push(value * 10));
    bus.on("pong", ({ value }) => pongs.push(value));

    bus.emit("ping", { value: 2 });

    expect(pings).toEqual([2, 20]);
    expect(pongs).toEqual([]);
  });

  test("emitting a type with no subscribers is a no-op", () => {
    const bus = new EventBus<TestEvents>();

    expect(() => bus.emit("ping", { value: 1 })).not.toThrow();
  });

  test("the handle returned by on() unsubscribes", () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    const off = bus.on("ping", ({ value }) => seen.push(value));

    bus.emit("ping", { value: 1 });
    off();
    bus.emit("ping", { value: 2 });

    expect(seen).toEqual([1]);
  });

  test("unsubscribing twice does not drop another subscriber", () => {
    const bus = new EventBus<TestEvents>();
    const first: number[] = [];
    const second: number[] = [];
    const offFirst = bus.on("ping", ({ value }) => first.push(value));
    bus.on("ping", ({ value }) => second.push(value));

    offFirst();
    offFirst();
    bus.emit("ping", { value: 1 });

    expect(first).toEqual([]);
    expect(second).toEqual([1]);
  });

  test("off() ignores a handler that was never subscribed", () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    bus.on("ping", ({ value }) => seen.push(value));

    expect(() => bus.off("ping", () => {})).not.toThrow();
    expect(() => bus.off("pong", () => {})).not.toThrow();

    bus.emit("ping", { value: 1 });
    expect(seen).toEqual([1]);
  });

  test("a handler that unsubscribes itself mid-emit still lets its peers run", () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];

    const off = bus.on("ping", () => {
      order.push("first");
      off();
    });
    bus.on("ping", () => order.push("second"));

    bus.emit("ping", { value: 1 });
    bus.emit("ping", { value: 2 });

    // emit() iterates a snapshot, so removing a subscriber during dispatch
    // never skips the one that happens to shift into its slot.
    expect(order).toEqual(["first", "second", "second"]);
  });

  test("a handler subscribed mid-emit is not called until the next emit", () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];

    bus.on("ping", () => {
      order.push("outer");
      bus.on("ping", () => order.push("inner"));
    });

    bus.emit("ping", { value: 1 });
    expect(order).toEqual(["outer"]);

    bus.emit("ping", { value: 2 });
    expect(order).toEqual(["outer", "outer", "inner"]);
  });

  test("a handler can emit re-entrantly without losing the outer dispatch", () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];

    bus.on("ping", ({ value }) => {
      order.push(`ping:${value}`);
      if (value < 2) {
        bus.emit("ping", { value: value + 1 });
      }
    });
    bus.on("ping", ({ value }) => order.push(`tail:${value}`));

    bus.emit("ping", { value: 1 });

    expect(order).toEqual(["ping:1", "ping:2", "tail:2", "tail:1"]);
  });
});
