import * as THREE from "three";
import type { Stage } from "../core/stage";
import {
  getPoolFitDistance,
  getResponsiveCameraDefaults,
  type CameraControls,
} from "../core/camera-controls";
import { getWaterSurfaceRadius } from "../core/world";
import { pseudoRandom } from "../core/math";
import type { LightingSystem } from "../core/lighting";
import { getBowlPlaneY, getBowlRimY } from "../bowls/profile";
import { createHeroBowlRimGeometry } from "../bowls/geometry";
import type { BowlMaterials } from "../bowls/materials";
import { heroBowlRimSegments, waterPlaneY } from "../config";
import type { SharedWaterUniforms } from "../water/uniforms";
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
// After a partial ring the hint returns sooner to explain what remains.
const midRitualHintDelayMs = 4000;
const strikeShudderDuration = 1.15;

// The piece begins after three chimes — a deliberate ritual, and each ring
// swells a little louder than the last.
const strikesToBegin = 3;
const strikeToneStrengths = [0.55, 0.66, 0.8];
const strikeRippleStrengths = [0.34, 0.42, 0.52];
// The completing chime rings out well past the first two.
const finalStrikeSustain = 1.75;
const strikeMinimumGap = 0.18;

const pointerNdc = new THREE.Vector2();
const pointerWorld = new THREE.Vector3();
const pointerRaycaster = new THREE.Raycaster();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

type IntroSequenceDeps = {
  stage: Stage;
  cameraControls: CameraControls;
  bus: EventBus<BasinEvents>;
  bowlSystem: BowlSystem;
  lighting: LightingSystem;
  materials: BowlMaterials;
  waterUniforms: SharedWaterUniforms;
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
  hint.textContent = "touch the bowl three times to begin";

  word.append(title, reflection, hint);

  const notice = document.createElement("p");
  notice.className = "intro__notice";
  notice.textContent = "sound on for this experience";

  overlay.append(word, notice);
  document.body.append(overlay);
  return overlay;
}

export function createIntroSequence(deps: IntroSequenceDeps): IntroSequence | null {
  const { camera, cameraTarget, renderer, scene } = deps.stage;
  const orbit = deps.cameraControls.orbit;
  const bowls = deps.bowlSystem.bowls;
  // reduce() with no seed throws on an empty array. The bowl count cannot reach
  // zero today, but the intro is meaningless without a hero bowl either way, so
  // it declines to run rather than taking the whole scene down with it.
  if (bowls.length === 0) {
    return null;
  }
  const hero = bowls.reduce((largest, bowl) =>
    bowl.radius > largest.radius ? bowl : largest,
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The hero sits at the pool's center for the title composition. Moving it
  // there can push it through its neighbors, so the layout is relaxed again
  // with the hero pinned: nothing may shift while the whole simulation waits,
  // frozen, for the last bowl to surface, so every pair has to clear now.
  hero.mesh.position.x = 0;
  hero.mesh.position.z = 0;
  hero.velocity.set(0, 0);
  const heroX = 0;
  const heroZ = 0;
  deps.bowlSystem.setFrozen(true);
  deps.bowlSystem.separate(hero);

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

  // The hero's impulse flare gets its own high-resolution rim for the intro
  // close-up: a lathe that hugs the bowl's rounded lip in 3D rather than the
  // faceted flat disc the instanced field rims share. It is driven by uniforms
  // and torn down at hand-off, when the hero rejoins the instanced field.
  const heroRim = new THREE.Mesh(
    createHeroBowlRimGeometry(heroBowlRimSegments),
    deps.materials.createHeroResonance(),
  );
  heroRim.frustumCulled = false;
  heroRim.renderOrder = 7;
  scene.add(heroRim);
  hero.rimFlareSuppressed = true;
  let heroRimActive = true;

  function syncHeroRim() {
    if (!heroRimActive) {
      return;
    }
    heroRim.position.set(
      hero.mesh.position.x,
      hero.mesh.position.y + getBowlRimY(hero.radius),
      hero.mesh.position.z,
    );
    heroRim.rotation.set(hero.visual.rotation.x, hero.mesh.rotation.y, hero.visual.rotation.z);
    heroRim.scale.setScalar(hero.radius);
    const resonance = hero.resonance;
    const uniforms = (heroRim.material as THREE.ShaderMaterial).uniforms;
    uniforms.uRimPulse.value.set(
      resonance.age,
      resonance.lifetime,
      resonance.strength,
      resonance.toneRatio,
    );
    uniforms.uRimImpactDirection.value.copy(resonance.impactDirection);
  }

  function teardownHeroRim() {
    if (!heroRimActive) {
      return;
    }
    heroRimActive = false;
    hero.rimFlareSuppressed = false;
    scene.remove(heroRim);
    heroRim.geometry.dispose();
    (heroRim.material as THREE.ShaderMaterial).dispose();
  }

  // The world lights start off entirely: only the spotlight touches the frame.
  const baseHemisphereIntensity = deps.lighting.hemisphere.intensity;
  const baseKeyIntensity = deps.lighting.key.intensity;
  deps.lighting.hemisphere.intensity = 0;
  deps.lighting.key.intensity = 0;

  const originalBackground = deps.stage.backgroundColor.clone();
  const introBackground = new THREE.Color(0x000000);
  const workingBackground = introBackground.clone();
  scene.background = workingBackground;
  renderer.toneMappingExposure = titleExposure;
  deps.waterUniforms.uSceneDim.value = Math.pow(titleExposure, sceneDimExponent);

  document.body.classList.add("is-intro");
  const overlay = createOverlay();

  let time = 0;
  let titleAzimuth = 0;
  let strikeCount = 0;
  let lastStrikeAt: number | null = null;
  let struckAt: number | null = null;
  let strikeAzimuth = 0;
  let strikeDirection = new THREE.Vector2(1, 0);
  let summonsEmitted = false;
  let emergedCount = reducedMotion ? emergenceEntries.length : 0;
  let handedOff = false;
  let handOffAt = 0;
  let finished = false;

  let idleTimer = window.setTimeout(() => {
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
    if (lastStrikeAt !== null && time - lastStrikeAt < strikeMinimumGap) {
      return;
    }

    strikeCount += 1;
    lastStrikeAt = time;
    const ring = Math.min(strikeCount, strikesToBegin) - 1;
    triggerBowlResonance(hero, 0.85 + ring * 0.12, direction);
    deps.bus.emit("ripple", {
      x: hero.mesh.position.x,
      z: hero.mesh.position.z,
      strength: strikeRippleStrengths[ring],
      direction,
    });
    void deps.startAudio()
      .then(() => {
        deps.bus.emit("tone", {
          sizeRatio: hero.toneRatio,
          strength: strikeToneStrengths[ring],
          sustain: ring === strikesToBegin - 1 ? finalStrikeSustain : 1,
        });
      })
      .catch((error) => {
        console.error("clinamen could not start audio.", error);
      });

    window.clearTimeout(idleTimer);
    overlay.classList.remove("is-idle");

    if (strikeCount < strikesToBegin) {
      idleTimer = window.setTimeout(() => {
        overlay.classList.add("is-idle");
      }, midRitualHintDelayMs);
      return;
    }

    // Third chime: the ritual is complete and the reveal begins.
    struckAt = time;
    strikeAzimuth = titleAzimuth;
    strikeDirection = direction;
    overlay.classList.add("is-leaving");
    window.setTimeout(() => {
      overlay.remove();
    }, 1700);

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
    deps.waterUniforms.uSceneDim.value = Math.pow(exposure, sceneDimExponent);
    workingBackground.lerpColors(introBackground, originalBackground, progress);
    deps.lighting.hemisphere.intensity = baseHemisphereIntensity * progress;
    deps.lighting.key.intensity = baseKeyIntensity * progress;
    spotlight.intensity = spotlightIntensity * (1 - progress);
    fillLight.intensity = fillLightIntensity * (1 - progress);
  }

  function restoreLighting() {
    renderer.toneMappingExposure = 1;
    deps.waterUniforms.uSceneDim.value = 1;
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
    orbit.azimuth = 0;
    orbit.pitch = THREE.MathUtils.clamp(pose.pitch, orbit.minPitch, orbit.maxPitch);
    orbit.distance = THREE.MathUtils.clamp(pose.distance, orbit.minDistance, orbit.maxDistance);
    orbit.hasUserControl = false;
    cameraTarget.set(0, 0, 0);
    deps.cameraControls.apply();
    restoreLighting();
    teardownHeroRim();
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
      entry.bowl.mesh.position.y = getBowlPlaneY(entry.bowl.radius, entry.bowl.emergence);
      if (!entry.rippled && getBowlPlaneY(entry.bowl.radius, entry.bowl.emergence) + getBowlRimY(entry.bowl.radius) > waterPlaneY) {
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

      // Every chime shivers the bowl like rung porcelain: fast, tiny, decaying.
      if (!reducedMotion && lastStrikeAt !== null) {
        const sinceHit = time - lastStrikeAt;
        if (sinceHit < strikeShudderDuration) {
          const decay = Math.exp(-sinceHit * 3.4) * 0.05;
          hero.visual.rotation.z = Math.sin(sinceHit * 44) * decay;
          hero.visual.rotation.x = Math.sin(sinceHit * 37 + 1.3) * decay * 0.64;
        }
      }

      syncHeroRim();

      if (struckAt === null) {
        // Title: hold the close-up with a barely-there breath of motion.
        titleAzimuth = Math.sin(time * 0.16) * titleAzimuthDrift;
        hero.mesh.position.y += Math.sin(time * 0.85) * 0.006;
        setIntroCamera(titleAzimuth, titlePitch, titleDistance, heroX, titleTargetY, heroZ);
        return;
      }

      const sinceStrike = time - struckAt;

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
      teardownHeroRim();
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
