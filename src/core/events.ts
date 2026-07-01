import type * as THREE from "three";

// Cross-system signals. A collision is detected by the bowl system but its
// consequences live elsewhere — a ripple in the water, a tone in the audio
// engine. The bus lets the bowl system announce the event without importing
// (or knowing about) those subsystems.
export type BasinEvents = {
  ripple: {
    x: number;
    z: number;
    strength: number;
    direction: THREE.Vector2;
  };
  tone: {
    sizeRatio: number;
    strength: number;
  };
};

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Array<Handler<Events[K]>> } = {};

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>) {
    (this.handlers[type] ??= []).push(handler);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>) {
    const list = this.handlers[type];
    if (!list) {
      return;
    }
    const index = list.indexOf(handler);
    if (index >= 0) {
      list.splice(index, 1);
    }
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    const list = this.handlers[type];
    if (!list) {
      return;
    }
    for (const handler of list.slice()) {
      handler(payload);
    }
  }
}
