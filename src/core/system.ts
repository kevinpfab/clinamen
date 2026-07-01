// A System owns a slice of the experience (its Three.js resources and per-frame
// behaviour). The composition root advances systems in an explicit order each
// frame and disposes them on teardown.

export type FrameContext = {
  delta: number;
  elapsed: number;
};

export interface System {
  update?(ctx: FrameContext): void;
  dispose?(): void;
}
