import * as THREE from "three";
import "./water-lab.css";
import { velocityWorldScale, waterSimulationStep } from "../config";
import { simulationSettings } from "../settings";
import type { BowlSystem } from "../bowls/system";
import type { BowlBody } from "../bowls/types";
import type { RippleField } from "../water/ripples";
import type { EventBus, BasinEvents } from "../core/events";
import type { Stage } from "../core/stage";
import type { CameraControls } from "../core/camera-controls";
import { getPoolFitDistance } from "../core/camera-controls";
import { getWaterSurfaceRadius } from "../core/world";
import type { DragState } from "../input/types";
import { createDragVelocity } from "../input/drag-velocity";

export type WaterLab = {
  readonly elapsed: number;
  consumeSteps: (rawDelta: number) => number;
  beforeStep: () => BowlBody | null;
  updateStatus: () => void;
  refreshCamera: () => void;
  dispose: () => void;
};

type WaterLabDeps = {
  bowlSystem: BowlSystem;
  ripples: RippleField;
  bus: EventBus<BasinEvents>;
  stage: Stage;
  cameraControls: CameraControls;
  resetWater: () => void;
};

const scenarios = ["Still bowl", "Head-on collision", "Glancing collision", "Drag and stop", "Ripple", "Crowd"] as const;
type Scenario = typeof scenarios[number];
const cameras = ["Close", "Low", "Overview", "Top"] as const;
type LabCamera = typeof cameras[number];

// This module is loaded only by the dev-only ?waterLab route. Scenarios use
// fixed-step production physics/rendering; only their starting conditions and
// the scripted drag differ from the public experience.
export function createWaterLab(deps: WaterLabDeps): WaterLab {
  const { bowlSystem, ripples, cameraControls, stage } = deps;
  const previousSettings = { ...simulationSettings };
  let scenario: Scenario = "Still bowl";
  let camera: LabCamera = "Close";
  let frame = 0;
  let pendingSteps = 0;
  let playbackDebt = 0;
  let playing = false;
  let collisions = 0;
  let drag: DragState | null = null;
  const previousPoint = new THREE.Vector2();
  const currentPoint = new THREE.Vector2();
  const panel = document.createElement("section");
  panel.className = "water-lab";
  panel.setAttribute("aria-label", "Water visual lab");
  const title = document.createElement("strong");
  title.textContent = "Water visual lab";
  panel.append(title);
  const description = document.createElement("p");
  description.textContent = "Fixed 60 Hz · currents and jets off · deterministic restart";
  panel.append(description);
  const scenarioButtons = new Map<Scenario, HTMLButtonElement>();
  const cameraButtons = new Map<LabCamera, HTMLButtonElement>();

  function row(label: string) {
    const group = document.createElement("div");
    group.className = "water-lab__row";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    panel.append(group);
    return group;
  }

  function button(group: HTMLElement, label: string, action: () => void) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.addEventListener("click", action);
    group.append(element);
    return element;
  }

  function refreshCamera() {
    const overview = getPoolFitDistance(getWaterSurfaceRadius(), stage.camera.fov, stage.camera.aspect);
    const distance = camera === "Overview" ? overview : camera === "Top" ? 6.4 : 4.6;
    cameraControls.orbit.distance = distance;
    cameraControls.orbit.pitch = camera === "Low" ? 0.19 : camera === "Top" ? Math.PI / 2 - 0.001 : 0.62;
    cameraControls.orbit.azimuth = 0;
    cameraControls.orbit.hasUserControl = true;
    stage.cameraTarget.set(0, 0, 0);
    cameraControls.apply();
    for (const [name, element] of cameraButtons) element.setAttribute("aria-pressed", String(name === camera));
  }

  function restart() {
    playing = false;
    frame = 0;
    pendingSteps = 0;
    playbackDebt = 0;
    collisions = 0;
    simulationSettings.bowlCount = scenario === "Crowd" ? 100 : scenario.includes("collision") ? 2 : 1;
    simulationSettings.minRadius = scenario === "Crowd" ? 0.25 : 0.45;
    simulationSettings.maxRadius = 0.5;
    bowlSystem.rebuild();
    bowlSystem.setFrozen(false);
    for (const [index, bowl] of bowlSystem.bowls.entries()) {
      bowl.velocity.set(0, 0);
      bowl.waterVelocity.set(0, 0);
      bowl.angularVelocity = 0;
      bowl.mesh.rotation.set(0, 0, 0);
      bowl.momentumStrength = 1;
      if (scenario !== "Crowd") {
        bowl.mesh.position.x = scenario.includes("collision") ? (index === 0 ? -0.75 : 0.75) : scenario === "Drag and stop" ? -1 : 0;
        bowl.mesh.position.z = scenario === "Glancing collision" ? (index === 0 ? -0.30 : 0.30) : 0;
      }
      if (scenario.includes("collision")) bowl.velocity.x = (index === 0 ? 0.8 : -0.8) / velocityWorldScale;
      if (scenario === "Crowd") {
        const angle = index * 2.399963229728653;
        bowl.velocity.set(Math.cos(angle), Math.sin(angle)).multiplyScalar(0.065);
      }
      bowl.waterVelocity.copy(bowl.velocity);
    }
    drag = null;
    if (scenario === "Drag and stop") {
      const bowl = bowlSystem.bowls[0];
      const point = new THREE.Vector2(bowl.mesh.position.x, bowl.mesh.position.z);
      drag = { bowl, pointerId: -1, offset: new THREE.Vector2(), lastRippleAt: 0, lastRipplePoint: point.clone(), velocity: createDragVelocity(point, 0) };
    }
    deps.resetWater();
    bowlSystem.updateInstances();
    for (const [name, element] of scenarioButtons) element.setAttribute("aria-pressed", String(name === scenario));
    updateStatus();
  }

  const scenarioRow = row("Scenarios");
  for (const name of scenarios) scenarioButtons.set(name, button(scenarioRow, name, () => { scenario = name; restart(); }));
  const transportRow = row("Playback");
  button(transportRow, "Restart", restart);
  const playButton = button(transportRow, "Play", () => { playing = !playing; playbackDebt = 0; updateStatus(); });
  function queueSteps(count: number) {
    playing = false;
    playbackDebt = 0;
    pendingSteps += count;
    updateStatus();
  }
  button(transportRow, "Step 0.25s", () => queueSteps(15));
  button(transportRow, "Step frame", () => queueSteps(1));
  const cameraRow = row("Camera");
  for (const name of cameras) cameraButtons.set(name, button(cameraRow, name, () => { camera = name; refreshCamera(); }));
  const status = document.createElement("output");
  status.className = "water-lab__status";
  panel.append(status);
  const offRipple = deps.bus.on("ripple", () => { collisions += 1; });
  document.body.append(panel);

  function updateStatus() {
    playButton.textContent = playing ? "Pause" : "Play";
    const phase = scenario === "Drag and stop" ? (frame <= 60 ? "Dragging" : "Held still") : scenario === "Ripple" ? (frame < 15 ? "Ripple at 0.25s" : "Ripple emitted") : "";
    const text = `${scenario} · t=${(frame * waterSimulationStep).toFixed(3)}s · frame ${frame} · collisions ${collisions} · ${playing ? "Playing" : "Paused"}${phase ? ` · ${phase}` : ""}`;
    if (status.textContent !== text) status.textContent = text;
  }

  restart();
  refreshCamera();
  return {
    get elapsed() { return frame * waterSimulationStep; },
    consumeSteps(rawDelta) {
      const queued = pendingSteps;
      pendingSteps = 0;
      if (!playing) return queued;
      playbackDebt += Math.max(0, Math.min(rawDelta, 0.1));
      const count = Math.floor((playbackDebt + 1e-9) / waterSimulationStep);
      playbackDebt = Math.max(0, playbackDebt - count * waterSimulationStep);
      return queued + count;
    },
    beforeStep() {
      frame += 1;
      const elapsed = frame * waterSimulationStep;
      if (scenario === "Ripple" && frame === 15) ripples.addCollisionRipple(-1.1, 0, 0.38, new THREE.Vector2(1, 0), 2.8);
      if (!drag) return null;
      const bowl = drag.bowl;
      previousPoint.set(bowl.mesh.position.x, bowl.mesh.position.z);
      currentPoint.set(-1 + Math.min(elapsed, 1) * 2, 0);
      bowl.mesh.position.x = currentPoint.x;
      bowl.mesh.position.z = currentPoint.y;
      bowl.velocity.copy(currentPoint).sub(previousPoint).divideScalar(waterSimulationStep * velocityWorldScale);
      ripples.updateDragWaterInteraction(drag, previousPoint, currentPoint, elapsed);
      return bowl;
    },
    updateStatus,
    refreshCamera,
    dispose() {
      offRipple();
      panel.remove();
      Object.assign(simulationSettings, previousSettings);
    },
  };
}
