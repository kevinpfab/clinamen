import type { GpuTimingSnapshot } from "../core/gpu-timer";

export type FpsCounterDiagnostics = {
  rafDelta: number;
  approxFps: number;
  work: number;
  gpu: GpuTimingSnapshot | null;
  steps: Record<string, number>;
  dpr: number;
  canvas: {
    width: number;
    height: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    points: number;
    geometries: number;
    textures: number;
  };
};

export type FpsCounter = {
  update: (now?: number, diagnostics?: FpsCounterDiagnostics) => void;
  destroy: () => void;
};

function formatNumber(value: number) {
  return String(Math.round(value));
}

function formatTiming(value: number) {
  return value.toFixed(1);
}

function formatGpuTiming(gpu: GpuTimingSnapshot | null) {
  if (!gpu) {
    return "--";
  }
  if (gpu.status === "unsupported") {
    return "unsupported";
  }
  if (gpu.status === "disjoint") {
    return "disjoint";
  }
  if (gpu.frameMs == null) {
    return "pending";
  }

  return `${formatTiming(gpu.frameMs)}ms / ${gpu.latencyFrames}f`;
}

function createMetricRow(label: string) {
  const row = document.createElement("span");
  row.className = "fps-counter__metric";

  const labelElement = document.createElement("span");
  labelElement.className = "fps-counter__metric-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("span");
  valueElement.className = "fps-counter__metric-value";
  valueElement.textContent = "--";

  row.append(labelElement, valueElement);
  return { row, valueElement };
}

export function createFpsCounter(): FpsCounter {
  const element = document.createElement("button");
  element.className = "fps-counter";
  element.type = "button";
  element.setAttribute("aria-label", "Frame diagnostics");
  element.setAttribute("aria-expanded", "false");

  const summary = document.createElement("span");
  summary.className = "fps-counter__summary";
  summary.textContent = "-- fps";

  const details = document.createElement("span");
  details.className = "fps-counter__details";

  const rafMetric = createMetricRow("RAF");
  const workMetric = createMetricRow("Work");
  const dprMetric = createMetricRow("DPR");
  const canvasMetric = createMetricRow("Canvas");
  const renderMetric = createMetricRow("Render");
  const bowlFieldMetric = createMetricRow("Bowl field");
  const waterSimMetric = createMetricRow("Water sim");
  const collisionMetric = createMetricRow("Collisions");
  const gpuMetric = createMetricRow("GPU");
  const drawMetric = createMetricRow("Draw");
  details.append(
    rafMetric.row,
    workMetric.row,
    dprMetric.row,
    canvasMetric.row,
    renderMetric.row,
    bowlFieldMetric.row,
    waterSimMetric.row,
    collisionMetric.row,
    gpuMetric.row,
    drawMetric.row,
  );

  element.append(summary, details);

  let frameCount = 0;
  let lastSampleAt = performance.now();

  element.addEventListener("click", () => {
    const isExpanded = !element.classList.contains("is-expanded");
    element.classList.toggle("is-expanded", isExpanded);
    element.setAttribute("aria-expanded", String(isExpanded));
  });
  document.body.append(element);

  return {
    update(now = performance.now(), diagnostics?: FpsCounterDiagnostics) {
      frameCount += 1;
      const elapsed = now - lastSampleAt;
      if (elapsed < 500) {
        return;
      }

      const fps = Math.round((frameCount * 1000) / elapsed);
      summary.textContent = `${fps} fps`;

      if (diagnostics) {
        rafMetric.valueElement.textContent = `${formatNumber(diagnostics.rafDelta)}ms / ${diagnostics.approxFps}fps`;
        workMetric.valueElement.textContent = `${formatTiming(diagnostics.work)}ms`;
        dprMetric.valueElement.textContent = diagnostics.dpr.toFixed(2);
        canvasMetric.valueElement.textContent = `${diagnostics.canvas.width} x ${diagnostics.canvas.height}`;
        renderMetric.valueElement.textContent = `${formatTiming(diagnostics.steps.render ?? 0)}ms`;
        bowlFieldMetric.valueElement.textContent = `${formatTiming(diagnostics.steps.bowlField ?? 0)}ms`;
        waterSimMetric.valueElement.textContent = `${formatTiming(diagnostics.steps.waterSim ?? 0)}ms`;
        collisionMetric.valueElement.textContent = `${formatTiming(diagnostics.steps.collisions ?? 0)}ms`;
        gpuMetric.valueElement.textContent = formatGpuTiming(diagnostics.gpu);
        drawMetric.valueElement.textContent = `${diagnostics.renderer.calls} calls / ${diagnostics.renderer.triangles} tris`;
      }

      frameCount = 0;
      lastSampleAt = now;
    },
    destroy() {
      element.remove();
    },
  };
}
