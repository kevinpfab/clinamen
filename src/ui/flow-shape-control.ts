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

// The basin notation control: small public controls for current shape and bowl
// density. Flow changes reset water state; count changes rebuild bowl bodies.
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

function createControlRow(labelText: string, ariaLabel: string) {
  const row = document.createElement("div");
  row.className = "basin-control__row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", ariaLabel);

  const label = document.createElement("span");
  label.className = "basin-control__label";
  label.textContent = labelText;
  row.append(label);

  return row;
}

export function createFlowShapeControl(deps: FlowShapeControlDeps) {
  flowShapeButtons.length = 0;
  bowlCountButtons.length = 0;

  const control = document.createElement("section");
  control.className = "basin-control";
  control.setAttribute("aria-label", "Basin controls");

  const flowRow = createControlRow("current", "Current pattern");

  for (const shape of FLOW_SHAPES) {
    const button = document.createElement("button");
    const label = FLOW_SHAPE_LABELS[shape];
    button.className = "basin-control__button basin-control__button--flow";
    button.type = "button";
    button.textContent = FLOW_SHAPE_GLYPHS[shape];
    button.title = label;
    button.setAttribute("aria-label", `Current: ${label}`);
    button.addEventListener("click", () => {
      deps.setFlowShape(shape);
      updateFlowShapeControl(deps.getFlowShape);
    });
    flowShapeButtons.push({ shape, button });
    flowRow.append(button);
  }

  const bowlRow = createControlRow("vessels", "Bowl count");

  for (const count of PUBLIC_BOWL_COUNTS) {
    const button = document.createElement("button");
    const label = `${count} bowls`;
    button.className = "basin-control__button basin-control__button--count";
    button.type = "button";
    button.textContent = String(count);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      deps.setBowlCount(count);
      updateBowlCountControl(deps.getBowlCount);
    });
    bowlCountButtons.push({ count, button });
    bowlRow.append(button);
  }

  control.append(flowRow, bowlRow);
  document.body.append(control);
  updateFlowShapeControl(deps.getFlowShape);
  updateBowlCountControl(deps.getBowlCount);

  return {
    destroy() {
      control.remove();
      flowShapeButtons.length = 0;
      bowlCountButtons.length = 0;
    },
  };
}
