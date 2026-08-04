# clinamen Design Document

## Current Implementation Snapshot

- Full-viewport Three.js basin with circular water, basin floor, wood surround, flow jets, porcelain bowl instancing, reflections, and GPU water/interaction fields.
- Default production density is 100 bowls, with public controls for 10, 50, and 100 bowls plus current pattern selection.
- Interaction includes camera orbit, wheel zoom, pinch zoom, bowl dragging, and velocity-aware release wakes.
- The piece opens on a title sequence: the visitor strikes the hero bowl three times to begin, and the pool emerges from black. `?skipIntro` hands straight to the pointer instead.
- Audio starts from the first scene gesture — the intro's opening strike doubles as the unlock, so there is no permission button. Frame/GPU diagnostics are development/query-param tooling, not production UI.
- Runtime ownership flows from one root: `main.ts` builds the Stage, `createApp` builds everything else from it. Every system is a `createX(deps)` factory, and anything holding GPU, DOM, or audio resources exposes `dispose()`, so a hot reload, a WebGL context-loss rebuild, and a page unload all follow the same teardown path.
- WebGL context loss is caught and recovered on the same Stage; construction failure and unrecoverable loss both surface the `#basin-fallback` message.
- Shadows are configured but disabled (`enableSceneShadows`): the piece reads as physical through reflection, refraction, and the wave fields instead, and skipping shadow maps buys the frame budget those fields spend.

## Vision

Create a full viewport Three.js experience: a brilliant blue basin of water holding drifting white porcelain bowls. The bowls vary in size, move slowly, collide softly, and trigger soothing microtonal tones whose pitch and timbre relate to bowl size. The result should feel minimalist, calm, luminous, and tactile.

## Core Experience

- Full width and height browser app with no marketing page or explanatory overlay.
- Brilliant blue water fills the scene.
- White porcelain bowls of varied diameters drift on the water surface.
- Bowls bounce into one another and the basin bounds with gentle, damped movement.
- Collisions emit quiet microtonal tones.
- Collisions create subtle visible ripples in the water.
- Larger bowls produce lower tones; smaller bowls produce higher tones.
- Lighting, shadows, reflections, and subtle water ripples make the scene feel physical.
- The camera opens in a composed overview and supports orbit, wheel zoom, and pinch zoom.
- The water reads as a circular basin with a visible floor and surrounding wood surface.
- Bowls can be directly dragged; release velocity feeds back into bowl motion and water wakes.

## Technical Direction

- Use Vite as the project scaffold.
- Use Three.js for rendering, camera, lights, shadows, geometry, materials, and animation.
- Use the Web Audio API for procedural sound synthesis.
- Keep physics simple and deterministic unless the interaction needs a physics engine later.
- Use custom shader material for water ripples.
- Use responsive resize handling so the app fills the viewport cleanly across desktop and mobile.

## Major Phases

### Phase 1: Project Foundation

1. Initialize a Vite project in the repository.
2. Install Three.js and any small helper libraries that are justified by the implementation.
3. Create a minimal app shell with a full viewport canvas.
4. Add basic renderer, scene, camera, animation loop, resize handling, and cleanup.
5. Establish project scripts for development, build, linting, and preview if applicable.

Acceptance criteria:

- `bun run dev` or the chosen package script starts the app.
- The canvas fills the viewport with no scrollbars.
- The scene renders a stable background color.
- Resize behavior is correct.

### Phase 2: Scene Composition

1. Create a full-screen abstract water plane.
2. Add a directly top-down orthographic camera composition.
3. Add key, fill, and ambient lighting.
4. Enable shadows and tune renderer settings.
5. Establish the visual scale of the world so bowl size, movement, water ripples, and screen-edge bounds feel coherent.

Acceptance criteria:

- The scene reads immediately as calm abstract water.
- Shadows are visible but soft.
- The camera framing feels intentional on desktop and mobile.

### Phase 3: Water Shader

1. Implement a simple custom shader for brilliant blue water.
2. Add layered low-amplitude ripple motion driven by time.
3. Add subtle collision ripple events that expand and fade without dominating the surface.
4. Add subtle specular highlights and surface variation.
5. Tune water color, brightness, and opacity for a vivid stylized pool-blue look.
6. Keep the shader inexpensive enough for smooth animation.

Acceptance criteria:

- Water has visible but understated motion.
- Collision ripples are visible but gentle.
- The effect remains calm rather than busy.
- The surface looks luminous blue without becoming visually noisy.

### Phase 4: Porcelain Bowl Modeling

1. Build a procedural bowl mesh using lathe geometry or a custom profile.
2. Create multiple bowl sizes from the same model.
3. Use a pure minimalist white porcelain material with roughness and modest clearcoat.
4. Add inner and outer surfaces so bowls read as hollow.
5. Model bowls as empty vessels.
6. Add soft contact shadows or real shadow casting onto the water/basin surface.

Acceptance criteria:

- Bowls look like elegant white porcelain.
- Bowls read as empty from the top-down camera.
- Size variation is clear but harmonious.
- Bowls remain readable from the chosen camera angle.

### Phase 5: Drift and Collision Simulation

1. Represent each bowl as a circular body on the water plane.
2. Give each bowl slow velocity, angular drift, and mild damping.
3. Keep bowls inside the basin bounds.
4. Resolve bowl-to-bowl collisions with gentle elastic response.
5. Add tiny bobbing and tilt motion so movement feels waterborne.
6. Emit collision events with strength and participants for the audio layer.

Acceptance criteria:

- Bowls drift slowly and never feel frantic.
- Collisions look soft, plausible, and stable.
- Bowls do not overlap or escape the basin.

### Phase 6: Microtonal Sound System

1. Create a Web Audio context that starts after the first user interaction.
2. Map bowl size to pitch, with larger bowls lower and smaller bowls higher.
3. Use a microtonal scale instead of standard equal temperament.
4. Trigger soft bell-like and singing-bowl-like tones on collision.
5. Vary tone by collision strength, relative velocity, and bowl pair.
6. Add gentle filtering, envelope shaping, delay, or reverb for a soothing sound field.
7. Prevent harsh overlaps with gain limiting, cooldowns, and voice management.

Acceptance criteria:

- Collision sounds are quiet, musical, and not repetitive.
- Pitch variation clearly relates to bowl size.
- Audio never becomes harsh or cluttered during repeated collisions.

### Phase 7: Interaction and App Polish

1. Add a minimal start state only if required for browser audio permission.
2. Use the first click or tap to wake audio, while preserving normal scene interaction.
3. Add a development-only debug/tuning mode for bowl count, scale, pitch mapping, water ripple strength, frame diagnostics, and motion.
4. Keep production UI minimal: audio start plus compact public controls for flow shape and bowl density.
5. Add graceful behavior for reduced motion or muted environments if practical.

Acceptance criteria:

- The first interaction enables audio cleanly.
- Any visible UI is minimal and consistent with the calm experience.
- The experience works with mouse and touch.

### Phase 8: Performance and Verification

1. Verify animation frame pacing on desktop and a mobile viewport.
2. Check scene rendering with screenshots.
3. Confirm shader, shadows, and bowls render correctly after resizing.
4. Test audio startup and collision-triggered playback in a browser.
5. Tune object count, shader work, shadow map size, and geometry detail.
6. Run build and lint/test scripts before delivery.

Acceptance criteria:

- The app builds successfully.
- The scene is nonblank and correctly framed.
- Motion is smooth with the expected number of bowls.
- Audio works after user interaction.

## Initial Implementation Defaults

- Bowl count: 100 by default, with public 10/50/100 density controls.
- Bowl diameter range: small, medium, and large across the configured radius range.
- Camera: perspective overview with orbit, wheel zoom, and pinch zoom.
- Basin: circular pool with basin floor, water surface, flow jets, and wood surround.
- Water color: vivid stylized pool-blue with slight cyan variation.
- Bowl material: pure minimalist white porcelain, high roughness, modest clearcoat.
- Bowls: empty vessels.
- Microtonal tuning: 19-tone equal temperament pitch palette, with modal overtones tuned by bowl size.
- Collision tone: soft bell and singing-bowl voice with gentle attack, long decay, and quiet reverb.
- Collision ripples: enabled, subtle, expanding, and quickly fading.
- Motion speed: slow drift with strong damping.
- Visual UI: only a small, tasteful start control if browser audio permission requires it.
- Debug mode: development-only tuning controls for motion, audio mapping, bowl count, scale, and ripple parameters.

## Resolved Creative Decisions

- Camera: responsive perspective overview with user orbit/zoom.
- Basin: circular pool with visible floor and surrounding wood.
- Bounds: circular basin edge keeps bowls in the pool.
- Sound: soft bells blended with singing-bowl tones.
- Tuning: implementation may choose the exact palette; initial plan uses 19-TET with modal synthesis.
- Interaction: direct bowl dragging plus camera orbit/zoom, while preserving calm default passive motion.
- Porcelain: pure minimalist white.
- Bowls: empty.
- Water color: vivid stylized pool-blue, like a heightened movie image.
- Collision ripples: subtle visible ripples.
- Debug mode: include development-only tuning controls.
- Reduced motion: deliberately not honored in the main scene. The piece *is* the motion — a still pool is not a calmer version of this work, it is a different one, and there is no reduced state that remains the piece. The intro title sequence does honor `prefers-reduced-motion`, because that one is an animation over content and has somewhere calm to land.

## Remaining Creative Questions

No major creative questions remain before the first implementation pass.

## Risks and Mitigations

- Browser audio restrictions require a user gesture. Use a minimal start interaction and keep the rest of the screen as the experience.
- Too many collision sounds can become busy. Add cooldowns, low gains, and a maximum simultaneous voice count.
- Bowls can jitter if collision resolution is too stiff. Use damping, low speeds, and simple position correction.
- Water shader can overpower the minimalist design. Keep ripple amplitude low and tune from screenshots.
- Shadows on transparent or shader water may be inconsistent. Use a receiving basin plane or tuned shadow surface if needed.

## Suggested First Build Slice

1. Scaffold Vite and render a full viewport Three.js scene.
2. Add water plane with animated blue shader.
3. Add three procedural porcelain bowls with simple drift.
4. Add circular collision response.
5. Add Web Audio collision tones after a click/tap start.
6. Expand to the target bowl count and polish visuals, motion, and sound.
