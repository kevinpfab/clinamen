import * as THREE from "three";
import { camera, cameraTarget, renderer, scene } from "../core/stage";
import {
  applyCameraOrbit,
  cameraOrbit,
  getPoolFitDistance,
  getResponsiveCameraDefaults,
} from "../core/camera-controls";
import { getWaterSurfaceRadius } from "../core/world";
import { pseudoRandom } from "../core/math";
import type { LightingSystem } from "../core/lighting";
import { getBowlCenterLimit } from "../bowls/tuning";
import { waterUniforms } from "../water/uniforms";
import { triggerBowlResonance } from "../bowls/resonance";
import type { BowlBody } from "../bowls/types";
import type { BowlSystem } from "../bowls/system";
import type { BasinEvents, EventBus } from "../core/events";

// The title sequence: a single bowl in darkness, the wordmark beneath it.
// Touching the bowl is the clinamen — the one swerve. It strikes the tonic
// tone (doubling as the browser audio-unlock gesture), then the darkness
// recedes while the camera pulls back and the remaining bowls surface in a
// wave expanding from the first bowl. Nothing else is scripted: once bowls
// emerge, the ordinary drift simulation produces the piece.

// Darkness. Exposure reaches the lit materials (porcelain, wood); uSceneDim
// reaches the unlit custom shaders (water, floor, reflections, spray). The
// power curve roughly matches ACES crush so both fade in step.
const titleExposure = 0.055;
const sceneDimExponent = 1.25;

// Title framing: an intimate, low, close-up pose the reveal sweeps out of.
const titlePitch = 0.3;
const titleDistance = 3.3;
const titleTargetY = 0.1;
const titleAzimuthDrift = 0.028;

// Hero spotlights — the museum-vitrine light plus a soft front fill so the
// bowl's outer wall reads, and the only lights during the title (the world
// lights are held at zero so the frame starts truly black). Intensity is
// candela, sized to read as normally-lit porcelain through the crushed
// title exposure. Only the porcelain reacts to them; the water and floors
// are unlit shaders, so neither light stains the darkness.
const spotlightIntensity = 2600;
const fillLightIntensity = 680;

const revealDelay = 0.9;
const revealDuration = 6;
const reducedRevealDelay = 0.25;
const reducedExposureDuration = 1.4;

// Emergence wave: it waits for the camera to settle into the overview, holds
// a beat, then the delay grows with distance from the hero bowl so the pool
// populates radially outward from the strike.
const emergencePause = 0.7;
const emergenceSpread = 3;
const emergenceJitter = 0.55;
const emergenceRiseDuration = 2.4;

const idleHintDelayMs = 8000;
const strikeShudderDuration = 1.15;

const pointerNdc = new THREE.Vector2();
const pointerWorld = new THREE.Vector3();
const pointerRaycaster = new THREE.Raycaster();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

type IntroSequenceDeps = {
  bus: EventBus<BasinEvents>;
  bowlSystem: BowlSystem;
  lighting: LightingSystem;
  startAudio: () => Promise<void>;
  onComplete: () => void;
};

export type IntroSequence = {
  update: (delta: number) => void;
  dispose: () => void;
};

type EmergenceEntry = {
  bowl: BowlBody;
  delay: number;
  rippled: boolean;
};

function smootherstep(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function logLerp(from: number, to: number, t: number) {
  return Math.exp(THREE.MathUtils.lerp(Math.log(from), Math.log(to), t));
}

function getOverviewPose() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const defaults = getResponsiveCameraDefaults(aspect);
  let distance = defaults.distance;
  if (aspect < 1) {
    distance = Math.max(
      distance,
      getPoolFitDistance(getWaterSurfaceRadius(), defaults.fov, aspect),
    );
  }
  return { pitch: defaults.pitch, distance };
}

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "intro";

  const word = document.createElement("div");
  word.className = "intro__word";

  const title = document.createElement("h1");
  title.className = "intro__title";
  title.textContent = "clinamen";

  const reflection = document.createElement("div");
  reflection.className = "intro__title-reflection";
  reflection.setAttribute("aria-hidden", "true");
  reflection.textContent = "clinamen";

  const hint = document.createElement("p");
  hint.className = "intro__hint";
  hint.textContent = "touch the bowl";

  word.append(title, reflection, hint);

  const notice = document.createElement("p");
  notice.className = "intro__notice";
  notice.textContent = "sound on for this experience";

  overlay.append(word, notice);
  document.body.append(overlay);
  return overlay;
}

export function createIntroSequence(deps: IntroSequenceDeps): IntroSequence {
  const bowls = deps.bowlSystem.bowls;
  const hero = bowls.reduce((largest, bowl) =>
    bowl.radius > largest.radius ? bowl : largest,
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The hero sits at the pool's center for the title composition. Neighbors
  // it would overlap are moved to spots verified clear of every other bowl,
  // so the layout stays collision-free and nothing shifts while the whole
  // simulation waits, frozen, for the last bowl to surface.
  hero.mesh.position.x = 0;
  hero.mesh.position.z = 0;
  hero.velocity.set(0, 0);
  const heroX = 0;
  const heroZ = 0;
  deps.bowlSystem.setFrozen(true);

  // The spawn scatter can leave overlapping pairs (its sampler falls back to
  // an unchecked center ring when the pool is crowded). The live simulation
  // used to separate those within a frame; frozen, they would surface visibly
  // intersecting. Relax the layout until every pair clears, with the centered
  // hero immovable.
  function clampToBasin(bowl: BowlBody) {
    const limit = getBowlCenterLimit(bowl.radius);
    const length = Math.hypot(bowl.mesh.position.x, bowl.mesh.position.z);
    if (length > limit) {
      const scale = limit / length;
      bowl.mesh.position.x *= scale;
      bowl.mesh.position.z *= scale;
    }
  }

  for (let iteration = 0; iteration < 120; iteration += 1) {
    let separated = true;
    for (let i = 0; i < bowls.length; i += 1) {
      for (let j = i + 1; j < bowls.length; j += 1) {
        const a = bowls[i];
        const b = bowls[j];
        const gap = a.contactRadius + b.contactRadius + 0.06;
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= gap) {
          continue;
        }

        separated = false;
        let normalX: number;
        let normalZ: number;
        if (distance > 0.001) {
          normalX = dx / distance;
          normalZ = dz / distance;
        } else {
          const angle = pseudoRandom(a.id * 13.7 + b.id * 3.1 + iteration * 0.7) * Math.PI * 2;
          normalX = Math.cos(angle);
          normalZ = Math.sin(angle);
        }

        const shortfall = gap - distance;
        if (a === hero || b === hero) {
          const mover = a === hero ? b : a;
          const sign = a === hero ? 1 : -1;
          mover.mesh.position.x += normalX * shortfall * sign;
          mover.mesh.position.z += normalZ * shortfall * sign;
          clampToBasin(mover);
        } else {
          const push = shortfall * 0.55;
          a.mesh.position.x -= normalX * push;
          a.mesh.position.z -= normalZ * push;
          b.mesh.position.x += normalX * push;
          b.mesh.position.z += normalZ * push;
          clampToBasin(a);
          clampToBasin(b);
        }
      }
    }

    if (separated) {
      break;
    }
  }

  const emergenceEntries: EmergenceEntry[] = [];
  let maxHeroDistance = 0.001;
  for (const bowl of bowls) {
    if (bowl === hero) {
      continue;
    }

    bowl.emergence = 0;
    // Rest until the simulation starts; the basin current then eases every
    // bowl into drift, so no one carries a phantom wake while frozen.
    bowl.velocity.set(0, 0);
    const heroDistance = Math.hypot(
      bowl.mesh.position.x - heroX,
      bowl.mesh.position.z - heroZ,
    );
    maxHeroDistance = Math.max(maxHeroDistance, heroDistance);
    emergenceEntries.push({ bowl, delay: heroDistance, rippled: false });
  }
  for (const entry of emergenceEntries) {
    entry.delay = emergencePause
      + (entry.delay / maxHeroDistance) * emergenceSpread
      + pseudoRandom(entry.bowl.id * 7.31 + 1.7) * emergenceJitter;
  }

  // Both lights sit on the camera's center axis (x = 0): off-axis light in a
  // black frame shifts the bowl's lit silhouette sideways and makes a
  // perfectly centered bowl read as off-center.
  const spotlight = new THREE.SpotLight(0xfff1de, spotlightIntensity, 0, 0.4, 0.9, 2);
  spotlight.position.set(heroX, 6.4, heroZ + 1.6);
  spotlight.target.position.set(heroX, 0, heroZ);
  // Front fill from the camera side so the outer porcelain wall stays visible
  // under the near-vertical key.
  const fillLight = new THREE.SpotLight(0xe8f0f4, fillLightIntensity, 0, 0.5, 0.95, 2);
  fillLight.position.set(heroX, 2.4, heroZ + 5.2);
  fillLight.target.position.set(heroX, 0.1, heroZ);
  scene.add(spotlight, spotlight.target, fillLight, fillLight.target);

  // The world lights start off entirely: only the spotlight touches the frame.
  const baseHemisphereIntensity = deps.lighting.hemisphere.intensity;
  const baseKeyIntensity = deps.lighting.key.intensity;
  deps.lighting.hemisphere.intensity = 0;
  deps.lighting.key.intensity = 0;

  const originalBackground = (scene.background as THREE.Color).clone();
  const introBackground = new THREE.Color(0x000000);
  const workingBackground = introBackground.clone();
  scene.background = workingBackground;
  renderer.toneMappingExposure = titleExposure;
  waterUniforms.uSceneDim.value = Math.pow(titleExposure, sceneDimExponent);

  document.body.classList.add("is-intro");
  const overlay = createOverlay();

  let time = 0;
  let titleAzimuth = 0;
  let struckAt: number | null = null;
  let strikeAzimuth = 0;
  let strikeDirection = new THREE.Vector2(1, 0);
  let summonsEmitted = false;
  let emergedCount = reducedMotion ? emergenceEntries.length : 0;
  let handedOff = false;
  let handOffAt = 0;
  let finished = false;

  const idleTimer = window.setTimeout(() => {
    overlay.classList.add("is-idle");
  }, idleHintDelayMs);

  function setIntroCamera(
    azimuth: number,
    pitch: number,
    distance: number,
    targetX: number,
    targetY: number,
    targetZ: number,
  ) {
    const horizontal = Math.cos(pitch) * distance;
    camera.position.set(
      targetX + Math.sin(azimuth) * horizontal,
      targetY + Math.sin(pitch) * distance,
      targetZ + Math.cos(azimuth) * horizontal,
    );
    camera.lookAt(targetX, targetY, targetZ);
    camera.updateMatrixWorld();
  }

  function strike(direction: THREE.Vector2) {
    if (struckAt !== null || finished) {
      return;
    }

    struckAt = time;
    strikeAzimuth = titleAzimuth;
    strikeDirection = direction;
    window.clearTimeout(idleTimer);
    overlay.classList.remove("is-idle");
    overlay.classList.add("is-leaving");
    window.setTimeout(() => {
      overlay.remove();
    }, 1700);

    triggerBowlResonance(hero, 1.05, direction);
    deps.bus.emit("ripple", {
      x: hero.mesh.position.x,
      z: hero.mesh.position.z,
      strength: 0.52,
      direction,
    });
    void deps.startAudio()
      .then(() => {
        deps.bus.emit("tone", { sizeRatio: hero.toneRatio, strength: 0.8 });
      })
      .catch((error) => {
        console.error("Microtonal Basin could not start audio.", error);
      });

    if (reducedMotion) {
      for (const entry of emergenceEntries) {
        entry.bowl.emergence = 1;
        entry.rippled = true;
      }
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (struckAt !== null) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    pointerRaycaster.setFromCamera(pointerNdc, camera);
    if (!pointerRaycaster.ray.intersectPlane(waterPlane, pointerWorld)) {
      return;
    }

    const offset = new THREE.Vector2(
      pointerWorld.x - hero.mesh.position.x,
      pointerWorld.z - hero.mesh.position.z,
    );
    if (offset.length() > Math.max(hero.radius * 2.4, 1.15)) {
      return;
    }

    strike(offset.lengthSq() > 0.0001 ? offset.normalize() : new THREE.Vector2(1, 0));
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    strike(new THREE.Vector2(0.7, -0.7).normalize());
  }

  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("keydown", handleKeyDown);

  function removeListeners() {
    renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("keydown", handleKeyDown);
  }

  function applyDarkness(progress: number) {
    const exposure = logLerp(titleExposure, 1, progress);
    renderer.toneMappingExposure = exposure;
    waterUniforms.uSceneDim.value = Math.pow(exposure, sceneDimExponent);
    workingBackground.lerpColors(introBackground, originalBackground, progress);
    deps.lighting.hemisphere.intensity = baseHemisphereIntensity * progress;
    deps.lighting.key.intensity = baseKeyIntensity * progress;
    spotlight.intensity = spotlightIntensity * (1 - progress);
    fillLight.intensity = fillLightIntensity * (1 - progress);
  }

  function restoreLighting() {
    renderer.toneMappingExposure = 1;
    waterUniforms.uSceneDim.value = 1;
    scene.background = originalBackground;
    deps.lighting.hemisphere.intensity = baseHemisphereIntensity;
    deps.lighting.key.intensity = baseKeyIntensity;
    scene.remove(spotlight, spotlight.target, fillLight, fillLight.target);
    spotlight.dispose();
    fillLight.dispose();
  }

  function handOff() {
    handedOff = true;
    handOffAt = time;
    removeListeners();
    const pose = getOverviewPose();
    cameraOrbit.azimuth = 0;
    cameraOrbit.pitch = THREE.MathUtils.clamp(pose.pitch, cameraOrbit.minPitch, cameraOrbit.maxPitch);
    cameraOrbit.distance = THREE.MathUtils.clamp(pose.distance, cameraOrbit.minDistance, cameraOrbit.maxDistance);
    cameraOrbit.hasUserControl = false;
    cameraTarget.set(0, 0, 0);
    applyCameraOrbit();
    restoreLighting();
    document.body.classList.remove("is-intro");
    deps.onComplete();
  }

  function updateEmergence(sinceHandOff: number) {
    for (const entry of emergenceEntries) {
      if (entry.bowl.emergence >= 1) {
        continue;
      }

      const riseProgress = (sinceHandOff - entry.delay) / emergenceRiseDuration;
      if (riseProgress <= 0) {
        continue;
      }

      entry.bowl.emergence = smootherstep(riseProgress);
      if (!entry.rippled && entry.bowl.emergence > 0.92) {
        entry.rippled = true;
        const outward = new THREE.Vector2(entry.bowl.mesh.position.x, entry.bowl.mesh.position.z);
        deps.bus.emit("ripple", {
          x: entry.bowl.mesh.position.x,
          z: entry.bowl.mesh.position.z,
          strength: 0.06 + entry.bowl.radius * 0.09,
          direction: outward.lengthSq() > 0.0001 ? outward.normalize() : new THREE.Vector2(1, 0),
        });
      }
      if (entry.bowl.emergence >= 1) {
        emergedCount += 1;
      }
    }
  }

  return {
    update(delta: number) {
      if (finished) {
        return;
      }

      time += delta;

      if (struckAt === null) {
        // Title: hold the close-up with a barely-there breath of motion.
        titleAzimuth = Math.sin(time * 0.16) * titleAzimuthDrift;
        hero.mesh.position.y += Math.sin(time * 0.85) * 0.006;
        setIntroCamera(titleAzimuth, titlePitch, titleDistance, heroX, titleTargetY, heroZ);
        return;
      }

      const sinceStrike = time - struckAt;

      if (!reducedMotion && sinceStrike < strikeShudderDuration) {
        // The struck bowl shivers like rung porcelain: fast, tiny, decaying.
        const decay = Math.exp(-sinceStrike * 3.4) * 0.05;
        hero.visual.rotation.z = Math.sin(sinceStrike * 44) * decay;
        hero.visual.rotation.x = Math.sin(sinceStrike * 37 + 1.3) * decay * 0.64;
      }

      if (!summonsEmitted && sinceStrike > 0.55) {
        // A second, softer ring: the wave that summons the rest of the bowls.
        summonsEmitted = true;
        deps.bus.emit("ripple", {
          x: hero.mesh.position.x,
          z: hero.mesh.position.z,
          strength: 0.3,
          direction: strikeDirection,
        });
      }

      const delay = reducedMotion ? reducedRevealDelay : revealDelay;
      const cameraProgress = reducedMotion
        ? (sinceStrike >= delay ? 1 : 0)
        : THREE.MathUtils.clamp((sinceStrike - delay) / revealDuration, 0, 1);
      const exposureProgress = reducedMotion
        ? THREE.MathUtils.clamp((sinceStrike - delay) / reducedExposureDuration, 0, 1)
        : cameraProgress;

      if (!handedOff) {
        const cameraEase = smootherstep(cameraProgress);
        const pose = getOverviewPose();
        setIntroCamera(
          THREE.MathUtils.lerp(strikeAzimuth, 0, cameraEase),
          THREE.MathUtils.lerp(titlePitch, pose.pitch, cameraEase),
          logLerp(titleDistance, pose.distance, cameraEase),
          heroX * (1 - cameraEase),
          titleTargetY * (1 - cameraEase),
          heroZ * (1 - cameraEase),
        );
        applyDarkness(smootherstep(exposureProgress));
      }

      if (!handedOff && cameraProgress >= 1 && exposureProgress >= 1) {
        handOff();
      }

      // The pool stays empty until the camera has settled; only then does the
      // emergence wave begin, and only once the last bowl has surfaced does
      // the simulation start.
      if (handedOff) {
        updateEmergence(time - handOffAt);
        if (emergedCount >= emergenceEntries.length) {
          finished = true;
          deps.bowlSystem.setFrozen(false);
        }
      }
    },

    dispose() {
      if (finished) {
        return;
      }
      finished = true;
      window.clearTimeout(idleTimer);
      removeListeners();
      overlay.remove();
      document.body.classList.remove("is-intro");
      if (!handedOff) {
        restoreLighting();
      }
      for (const entry of emergenceEntries) {
        entry.bowl.emergence = 1;
      }
      deps.bowlSystem.setFrozen(false);
    },
  };
}
