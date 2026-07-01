import * as THREE from "three";
import type { DebugSlider } from "./types";

type DebugPanelDeps = {
  getMasterVolume: () => number;
  setMasterVolume: (value: number) => void;
  getToneGain: () => number;
  setToneGain: (value: number) => void;
  getImpactMomentumFloor: () => number;
  setImpactMomentumFloor: (value: number) => void;
  getBowlCount: () => number;
  setBowlCount: (value: number) => void;
  getMinRadius: () => number;
  getMaxRadius: () => number;
  setBowlSizeRange: (minRadius: number, maxRadius: number) => void;
  playTestTone: () => Promise<void>;
};

// Development-only tuning panel: audio levels, bowl count, and size range, plus
// a test-tone button. Hidden in production and on coarse-pointer devices.
function createDebugSlider(options: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onInput: (value: number) => void;
}): DebugSlider {
  const element = document.createElement("label");
  element.className = "debug-slider";

  const header = document.createElement("span");
  header.className = "debug-slider__header";

  const label = document.createElement("span");
  label.textContent = options.label;

  const value = document.createElement("span");
  value.className = "debug-slider__value";
  value.textContent = options.format(options.value);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  input.addEventListener("input", () => {
    const nextValue = Number(input.value);
    value.textContent = options.format(nextValue);
    options.onInput(nextValue);
  });

  header.append(label, value);
  element.append(header, input);

  return {
    element,
    input,
    value,
    setValue(nextValue: number) {
      input.value = String(nextValue);
      value.textContent = options.format(nextValue);
    },
  };
}

function isMobileDevice() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function createDebugPanel(deps: DebugPanelDeps) {
  if (!import.meta.env.DEV || isMobileDevice()) {
    return;
  }

  const panel = document.createElement("section");
  panel.className = "debug-panel";

  const title = document.createElement("div");
  title.className = "debug-panel__title";
  title.textContent = "Debug";

  const volumeSlider = createDebugSlider({
    label: "Master volume",
    min: 0,
    max: 1.8,
    step: 0.01,
    value: deps.getMasterVolume(),
    format: (value) => `${Math.round(value * 100)}%`,
    onInput: (value) => {
      deps.setMasterVolume(value);
    },
  });

  const toneSlider = createDebugSlider({
    label: "Tone gain",
    min: 0.4,
    max: 3,
    step: 0.05,
    value: deps.getToneGain(),
    format: (value) => `${value.toFixed(2)}x`,
    onInput: (value) => {
      deps.setToneGain(value);
    },
  });

  const impactFloorSlider = createDebugSlider({
    label: "Impact floor",
    min: 0,
    max: 0.06,
    step: 0.001,
    value: deps.getImpactMomentumFloor(),
    format: (value) => value.toFixed(3),
    onInput: (value) => {
      deps.setImpactMomentumFloor(value);
    },
  });

  const countSlider = createDebugSlider({
    label: "Bowls",
    min: 3,
    max: 100,
    step: 1,
    value: deps.getBowlCount(),
    format: (value) => String(Math.round(value)),
    onInput: (value) => {
      deps.setBowlCount(Math.round(value));
    },
  });

  let minSizeSlider: DebugSlider;
  let maxSizeSlider: DebugSlider;

  const syncSizeSliders = () => {
    minSizeSlider.setValue(deps.getMinRadius());
    maxSizeSlider.setValue(deps.getMaxRadius());
  };

  const setSizeRange = (nextMinRadius: number, nextMaxRadius: number, changed: "min" | "max") => {
    const floor = 0.22;
    const ceiling = 1.35;
    const minimumGap = 0.1;
    let minRadius = THREE.MathUtils.clamp(nextMinRadius, floor, ceiling - minimumGap);
    let maxRadius = THREE.MathUtils.clamp(nextMaxRadius, floor + minimumGap, ceiling);

    if (maxRadius - minRadius < minimumGap) {
      if (changed === "min") {
        minRadius = Math.min(minRadius, ceiling - minimumGap);
        maxRadius = minRadius + minimumGap;
      } else {
        maxRadius = Math.max(maxRadius, floor + minimumGap);
        minRadius = maxRadius - minimumGap;
      }
    }

    deps.setBowlSizeRange(minRadius, maxRadius);
    syncSizeSliders();
  };

  const formatSize = (radius: number) => `${(radius * 2).toFixed(2)}d`;

  minSizeSlider = createDebugSlider({
    label: "Smallest bowl",
    min: 0.22,
    max: 1.25,
    step: 0.01,
    value: deps.getMinRadius(),
    format: formatSize,
    onInput: (value) => {
      setSizeRange(value, deps.getMaxRadius(), "min");
    },
  });

  maxSizeSlider = createDebugSlider({
    label: "Largest bowl",
    min: 0.32,
    max: 1.35,
    step: 0.01,
    value: deps.getMaxRadius(),
    format: formatSize,
    onInput: (value) => {
      setSizeRange(deps.getMinRadius(), value, "max");
    },
  });

  const testButton = document.createElement("button");
  testButton.className = "debug-button";
  testButton.type = "button";
  testButton.textContent = "Test tone";
  testButton.addEventListener("click", async () => {
    await deps.playTestTone();
  });

  panel.append(
    title,
    volumeSlider.element,
    toneSlider.element,
    impactFloorSlider.element,
    countSlider.element,
    minSizeSlider.element,
    maxSizeSlider.element,
    testButton,
  );
  document.body.append(panel);

  return {
    destroy() {
      panel.remove();
    },
  };
}
