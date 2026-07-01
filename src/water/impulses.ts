export type WaterImpulse = {
  x: number;
  z: number;
  radius: number;
  strength: number;
};

export class WaterImpulseQueue {
  private readonly slots: WaterImpulse[];
  private start = 0;
  private length = 0;

  constructor(private readonly capacity: number) {
    this.slots = Array.from(
      { length: Math.max(0, capacity) },
      () => ({ x: 0, z: 0, radius: 0, strength: 0 }),
    );
  }

  get count() {
    return this.length;
  }

  enqueue(x: number, z: number, radius: number, strength: number) {
    if (this.capacity <= 0) {
      return;
    }

    const index = this.length < this.capacity
      ? (this.start + this.length) % this.capacity
      : this.start;
    const slot = this.slots[index];
    slot.x = x;
    slot.z = z;
    slot.radius = radius;
    slot.strength = strength;

    if (this.length < this.capacity) {
      this.length += 1;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  clear() {
    this.start = 0;
    this.length = 0;
  }

  *entries() {
    for (let i = 0; i < this.length; i += 1) {
      yield this.slots[(this.start + i) % this.capacity];
    }
  }
}
