# clinamen Design Document

## Current Implementation Snapshot

- Full-viewport Three.js basin with circular water, basin floor, wood surround, flow jets, porcelain bowl instancing, reflections, and a GPU height-field wave solver.
- Default production density is 100 bowls, with public controls for 10, 50, and 100 bowls plus current pattern selection.
- Interaction includes camera orbit, wheel zoom, pinch zoom, bowl dragging, and filtered release momentum. Moving hulls drive water pressure through the same path whether dragged, released, or carried by the current.
- The piece opens on a title sequence: the visitor strikes the hero bowl three times to begin, and the pool emerges from black. `?skipIntro` hands straight to the pointer instead.
- Audio starts from the first scene gesture — the intro's opening strike doubles as the unlock, so there is no permission button. Frame/GPU diagnostics are development/query-param tooling, not production UI.
- Runtime ownership flows from one root: `main.ts` builds the Stage, `createApp` builds everything else from it. Every system is a `createX(deps)` factory, and anything holding GPU, DOM, or audio resources exposes `dispose()`, so a hot reload, a WebGL context-loss rebuild, and a page unload all follow the same teardown path.
- WebGL context loss is caught and recovered on the same Stage; construction failure and unrecoverable loss both surface the `#basin-fallback` message.
- Shadows are configured but disabled (`enableSceneShadows`): the piece reads as physical through reflection, refraction, and the wave fields instead, and skipping shadow maps buys the frame budget those fields spend.
- The development-only `?waterLab` route supplies six repeatable scenes, paused initial conditions, exact 60 Hz stepping, and four camera presets. It uses production physics and water rendering with currents and jets disabled. See [Water Visual Testing](WATER_VISUAL_TESTING.md).

## Bowl and Water Architecture

- `bowls/profile.ts` owns the scalable shell profile, crown height, resting draft, and hull–water intersection. The resting draft is 12% of bowl height. Surface footprints and menisci follow the outer hull at the water plane, and fade in only when the crown emerges. Bowls remain empty vessels; the water surface is masked out inside their hulls.
- `bowls/pose.ts` composes the common shell/rim transform and its world-space mirror. All flare geometry uses the bowl's local origin, including the intro's finer band. Reflections retain their physical scale and clip at the water plane. Only active field flares are submitted for rendering.
- Bowl picking first raycasts the rendered porcelain shell, refreshing instance bounds only on a pick. The water-plane footprint remains a forgiving fallback; selection no longer relies on the elevated shell projecting inside that footprint at shallow angles.
- `input/drag-velocity.ts` estimates held motion from timestamped positions and filters release momentum separately. Both estimates expire when the pointer stops. `waterVelocity` is the motion presented to the water after collision resolution; frozen and emerging bowls publish zero translation.
- `core/simulation-clock.ts` supplies one bounded timeline for CPU motion, shader phase, and fixed GPU steps. Slow frames consume a bounded amount of simulation time without letting shader phase run ahead. Physical pool resizing, density changes, and flow changes reset the water fields together.
- `water/ripples.ts` injects one local, volume-balanced collision impulse into `water/simulation.ts`. The GPU solver owns propagation and boundary response. Historical analytic collision rings and the separate drag-only wake API have been removed, so an event does not launch overlapping simulated and analytic wave packets.
- `water/bowl-field.ts` rasterizes compact instanced hull-contact patches with counterclockwise winding. Each patch carries meniscus height, signed bow/stern pressure, and the dry footprint. Pressure follows world speed for every moving bowl; a stopped bowl retains its contact without continuing to force a wake. Detached waves travel through the solver rather than long trail-shaped splats. Patch edges fade to zero before their raster boundaries.
- `water/wave-state.ts` combines simulation, interaction, and bowl fields into two attachments in one MRT pass, then derives slopes/caustics/foam in a second pass. Normals depend on signed displacement rather than positive energy envelopes. Surface shading and bowl reflections share the derived slopes; reflections use two texture reads per vertex instead of reconstructing neighboring gradients.
- Water shading reflects a stationary procedural studio environment, allowing moving normals to reveal subdued ripples through changing reflections and refraction. Ordinary waves do not need an independently painted white ring to remain visible. Basin-floor footprints are softened, and wave focus modulates the projected caustic pattern rather than duplicating a bright surface crest on the floor.
- The basin has a shaded inward-facing wall joining its floor to the water plane. Development frame diagnostics accumulate all field and scene passes before resetting their draw counters. Fewer sources, compact patches, and shared samples are architectural savings; they are not a substitute for measured frame timing.

These changes preserve the lightweight CPU collision model and GPU wave grid. The water surface remains geometrically flat, and reflections remain distorted mirrored bowl geometry. The system does not perform fluid–rigid-body coupling or GPU-to-CPU height readback.

### Validation and Visual Review

The coding validation is `bun run lint && bun test && bun run build`. The current suite contains 87 tests, including hull contact and emergence, shared/mirrored poses, wide rim geometry, drag stopping/release, collision impulse behavior, wave resets, and timeline consistency across frame rates. These checks do not establish shader compilation, appearance, interaction feel, or GPU timing.

Browser and visual checks were explicitly authorized for this iteration. The still, isolated-ripple, head-on, glancing, drag-and-stop, and crowd scenes were inspected in Chrome, including Close, Low, Overview, and Top views. [Water Visual Testing](WATER_VISUAL_TESTING.md) records repeatable scene/time recipes, controls, and remaining limitations. The priority is subdued, plausible ripples during bowl movement and collision: one propagating disturbance, no lingering source glow, and no renewed forcing after a drag stops.

The lab isolates water behavior; production review must still cover the three intro strikes and bowl emergence, gentle drift at 100 bowls with currents and jets, an actual drag–hold–release gesture, shallow camera orbits, mobile rim pulses, and changing orientation/density/current patterns. Compare complete-frame GPU timing during playback at matched settings. Paused lab renders and batches of manual steps do not represent normal frame cost. Mobile-device performance has not been validated, and no measured performance improvement is claimed here.

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
