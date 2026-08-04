import { FLOW_SHAPES, FLOW_SHAPE_LABELS, type FlowShape } from "../physics/flow";

type FlowShapeControlDeps = {
  getFlowShape: () => FlowShape;
  getBowlCount: () => number;
  setFlowShape: (shape: FlowShape) => void;
  setBowlCount: (count: PublicBowlCount) => void;
};

const PUBLIC_BOWL_COUNTS = [10, 50, 100] as const;
type PublicBowlCount = typeof PUBLIC_BOWL_COUNTS[number];

const FLOW_SHAPE_GLYPHS: Record<FlowShape, string> = {
  centered: ")(",
  ring: "\u25cb",
  singularity: "\u2022",
};

const BOWL_COUNT_WHISPERS: Record<PublicBowlCount, string> = {
  10: "ten vessels",
  50: "fifty vessels",
  100: "one hundred vessels",
};

// The basin notation control: bare glyphs resting in the corner vignette, no
// container. A whisper line beneath names whatever is hovered or focused.
// Flow changes reset water state; count changes rebuild bowl bodies.
const flowShapeButtons: Array<{ shape: FlowShape; button: HTMLButtonElement }> = [];
const bowlCountButtons: Array<{ count: PublicBowlCount; button: HTMLButtonElement }> = [];

function updateFlowShapeControl(getFlowShape: () => FlowShape) {
  for (const entry of flowShapeButtons) {
    const isActive = entry.shape === getFlowShape();
    entry.button.classList.toggle("is-active", isActive);
    entry.button.setAttribute("aria-pressed", String(isActive));
  }
}

function updateBowlCountControl(getBowlCount: () => number) {
  for (const entry of bowlCountButtons) {
    const isActive = entry.count === getBowlCount();
    entry.button.classList.toggle("is-active", isActive);
    entry.button.setAttribute("aria-pressed", String(isActive));
  }
}

function createControlRow(ariaLabel: string) {
  const row = document.createElement("div");
  row.className = "basin-control__row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", ariaLabel);
  return row;
}

export function createFlowShapeControl(deps: FlowShapeControlDeps) {
  flowShapeButtons.length = 0;
  bowlCountButtons.length = 0;

  const control = document.createElement("section");
  control.className = "basin-control";
  control.setAttribute("aria-label", "Basin controls");

  const whisper = document.createElement("p");
  whisper.className = "basin-control__whisper";
  whisper.setAttribute("aria-hidden", "true");
  whisper.innerHTML = "&nbsp;";

  const attachWhisper = (button: HTMLButtonElement, name: string) => {
    const show = () => {
      whisper.textContent = name;
      whisper.classList.add("is-on");
    };
    button.addEventListener("mouseenter", show);
    button.addEventListener("focus", show);
  };

  const flowRow = createControlRow("Current pattern");

  for (const shape of FLOW_SHAPES) {
    const button = document.createElement("button");
    const label = FLOW_SHAPE_LABELS[shape];
    button.className = "basin-control__button basin-control__button--flow";
    button.type = "button";
    button.textContent = FLOW_SHAPE_GLYPHS[shape];
    button.setAttribute("aria-label", `Current: ${label}`);
    attachWhisper(button, label.toLowerCase());
    button.addEventListener("click", () => {
      deps.setFlowShape(shape);
      updateFlowShapeControl(deps.getFlowShape);
    });
    flowShapeButtons.push({ shape, button });
    flowRow.append(button);
  }

  const bowlRow = createControlRow("Bowl count");

  for (const count of PUBLIC_BOWL_COUNTS) {
    const button = document.createElement("button");
    button.className = "basin-control__button basin-control__button--count";
    button.type = "button";
    button.textContent = String(count);
    button.setAttribute("aria-label", `${count} bowls`);
    attachWhisper(button, BOWL_COUNT_WHISPERS[count]);
    button.addEventListener("click", () => {
      deps.setBowlCount(count);
      updateBowlCountControl(deps.getBowlCount);
    });
    bowlCountButtons.push({ count, button });
    bowlRow.append(button);
  }

  const hideWhisper = () => whisper.classList.remove("is-on");
  control.addEventListener("mouseleave", hideWhisper);
  control.addEventListener("focusout", hideWhisper);

  control.append(flowRow, bowlRow, whisper);
  document.body.append(control);
  updateFlowShapeControl(deps.getFlowShape);
  updateBowlCountControl(deps.getBowlCount);

  return {
    dispose() {
      control.remove();
      flowShapeButtons.length = 0;
      bowlCountButtons.length = 0;
    },
  };
}
