import * as THREE from "three";

type DisjointTimerQueryWebGL2 = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

export type GpuTimingStatus = "available" | "pending" | "unsupported" | "disjoint";

export type GpuTimingSnapshot = {
  status: GpuTimingStatus;
  frameMs: number | null;
  latencyFrames: number;
  pendingQueries: number;
  sampleCount: number;
};

type PendingGpuQuery = {
  query: WebGLQuery;
  frameIndex: number;
};

const maxPendingGpuQueries = 8;

function isWebGL2Context(context: WebGLRenderingContext): context is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext;
}

const unsupportedGpuTiming: GpuTimingSnapshot = {
  status: "unsupported",
  frameMs: null,
  latencyFrames: 0,
  pendingQueries: 0,
  sampleCount: 0,
};

class GpuFrameTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly extension: DisjointTimerQueryWebGL2 | null;
  private readonly pendingQueries: PendingGpuQuery[] = [];
  private activeQuery: WebGLQuery | null = null;
  private frameIndex = 0;
  private latestFrameMs: number | null = null;
  private latestLatencyFrames = 0;
  private sampleCount = 0;
  private status: GpuTimingStatus = "unsupported";

  constructor(renderer: THREE.WebGLRenderer) {
    const context = renderer.getContext();
    if (!isWebGL2Context(context)) {
      this.gl = null;
      this.extension = null;
      return;
    }

    this.gl = context;
    this.extension = context.getExtension("EXT_disjoint_timer_query_webgl2") as DisjointTimerQueryWebGL2 | null;
    this.status = this.extension ? "pending" : "unsupported";
  }

  beginFrame() {
    if (
      !this.gl ||
      !this.extension ||
      this.activeQuery ||
      this.pendingQueries.length >= maxPendingGpuQueries
    ) {
      return;
    }

    const query = this.gl.createQuery();
    if (!query) {
      return;
    }

    this.activeQuery = query;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
  }

  endFrame() {
    if (!this.gl || !this.extension || !this.activeQuery) {
      return;
    }

    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pendingQueries.push({
      query: this.activeQuery,
      frameIndex: this.frameIndex,
    });
    this.activeQuery = null;
    this.frameIndex += 1;
  }

  collect(): GpuTimingSnapshot {
    if (!this.gl || !this.extension) {
      return unsupportedGpuTiming;
    }

    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      this.deletePendingQueries();
      this.latestFrameMs = null;
      this.latestLatencyFrames = 0;
      this.status = "disjoint";
      return this.createSnapshot();
    }

    for (let i = 0; i < this.pendingQueries.length; i += 1) {
      const pending = this.pendingQueries[i];
      const available = this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT_AVAILABLE);
      if (!available) {
        break;
      }

      const elapsedNanoseconds = Number(this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT));
      this.gl.deleteQuery(pending.query);
      this.pendingQueries.splice(i, 1);
      i -= 1;

      this.latestFrameMs = elapsedNanoseconds / 1_000_000;
      this.latestLatencyFrames = Math.max(0, this.frameIndex - pending.frameIndex);
      this.sampleCount += 1;
      this.status = "available";
    }

    if (this.latestFrameMs == null && this.pendingQueries.length > 0) {
      this.status = "pending";
    }

    return this.createSnapshot();
  }

  dispose() {
    if (!this.gl) {
      return;
    }

    if (this.activeQuery) {
      this.gl.deleteQuery(this.activeQuery);
      this.activeQuery = null;
    }
    this.deletePendingQueries();
  }

  private deletePendingQueries() {
    if (!this.gl) {
      return;
    }

    for (const pending of this.pendingQueries) {
      this.gl.deleteQuery(pending.query);
    }
    this.pendingQueries.length = 0;
  }

  private createSnapshot(): GpuTimingSnapshot {
    return {
      status: this.status,
      frameMs: this.latestFrameMs,
      latencyFrames: this.latestLatencyFrames,
      pendingQueries: this.pendingQueries.length,
      sampleCount: this.sampleCount,
    };
  }
}

export function createGpuFrameTimer(renderer: THREE.WebGLRenderer) {
  return new GpuFrameTimer(renderer);
}
