# Water Visual Testing

Use the development lab to compare the same water state before and after a change. Browser and visual checks are authorized for the current iteration; the coding baseline remains `bun run lint && bun test && bun run build`.

## Open the lab

1. Run `bun run dev` and open the local address printed by Vite with `?waterLab` appended.
2. Keep the browser viewport, device pixel ratio, camera preset, and device/input mode unchanged between comparisons.
3. Select a scene. It restarts paused at frame 0 with cleared water and repeatable bowl positions and velocities.
4. Advance to the desired frame, then inspect the stationary image from multiple presets. Camera changes do not advance simulation time.

The route is enabled only in development. It bypasses the intro and normal pointer controls and disables basin currents and jets. The scripted drag is not a test of browser pointer events or release-velocity estimation. A production build or `bun run preview` does not expose the lab.

## Controls

| Control | Behavior |
| --- | --- |
| Scene buttons | Select initial conditions, clear water, and return to paused frame 0. |
| Restart | Restart the selected scene without changing the camera preset. |
| Play / Pause | Advance or hold the scene using fixed 1/60-second simulation steps. |
| Step 0.25s | Pause and queue exactly 15 simulation steps. |
| Step frame | Pause and queue one simulation step. |
| Close | Oblique detail view centered on the scene. |
| Low | Shallow view for the waterline, reflected bowls, and ripple highlights. |
| Overview | Fit the basin for overall balance and the crowd scene. |
| Top | Near-vertical view for wave shape and empty bowl interiors. |

The status shows the scene, simulation time, frame number, collision-event count, playback state, and the scripted phase where applicable. Wait for the displayed frame to reach the target after queuing steps. Restart before each recipe; the recipes specify absolute times from restart.

## Repeatable comparisons

| Scene | Times / frames to inspect | What to look for |
| --- | --- | --- |
| Still bowl | 0 s / 0, 1 s / 60, 3 s / 180 | Porcelain stays empty and meets the water. The meniscus should remain local and restrained. Inspect Close and Low for suspended-looking contact, solid dark floor discs, or autonomous waves. |
| Head-on collision | 0.25 s / 15, 0.50 s / 30, 0.75 s / 45, 1.50 s / 90 | Two bowls approach at an initial 0.8 world units/s each. Use the collision counter and single frames to locate contact. Look for a subdued expanding disturbance, fading reflection distortion, and no stationary bright spot or independently moving duplicate rings. |
| Glancing collision | 0.25 s / 15, 0.50 s / 30, 0.75 s / 45, 1.50 s / 90 | The offset pair should produce a coherent contact disturbance as it separates. Compare Top for wave shape and Low for moving highlights; brightness should respond to the view and surface slope. |
| Drag and stop | 0.50 s / 30, 1 s / 60, 61 frames, 1.25 s / 75, 2 s / 120 | The bowl travels from x=-1 to x=+1 over one second, then remains held. Frame 61 is the first stationary step. New contact pressure must stop while existing waves continue outward and decay. Old bowl positions should not retain bow-shaped glow patches. |
| Ripple | 0.25 s / 15, 0.50 s / 30, 1 s / 60, 1.50 s / 90, 2.50 s / 150 | A single strength-0.38 collision impulse is injected at x=-1.1, z=0 on frame 15 beside a stationary bowl. Compare the primary packet, attenuation, and interaction with the bowl's reflected image. A crest/trough pair is expected; a second independently traveling analytic packet is not. |
| Crowd | 0 s / 0, 1 s / 60, 3 s / 180, then Play | One hundred bowls begin with repeatable velocities and varied radii. Use Overview to judge whether combined disturbances remain calm; use Close to inspect overlapping wakes. This scene excludes production currents and jets. |

For quarter-second targets, click **Step 0.25s** the corresponding number of times from restart: twice for 0.50 s, four times for 1 s, and twelve times for 3 s. Use **Step frame** for contact timing or the first stopped-drag frame.

For screenshots or notes, record the scene, camera, frame, viewport, device pixel ratio, and revision. A name such as `ripple-low-f060.png` identifies the lab state, but the accompanying viewport and revision are still necessary. Fixed stepping makes within-device comparisons repeatable; it does not promise identical pixels across GPU drivers or devices.

## Production interaction checks

Open the normal development route for the intro, or `?skipIntro` to start with scene interaction. Verify:

- All three intro strikes, the hero flare, reflected shudder, and bowl emergence.
- A gentle drag and a fast drag, each followed by holding still and releasing. A stopped hold must not regain stale release momentum or keep generating water pressure.
- Ordinary drifting and collisions at 10, 50, and 100 bowls with production currents and jets enabled.
- Orbit, wheel and pinch zoom, shallow views, and responsive resizing. Recheck empty interiors and reflection clipping at low angles.
- Coarse-pointer rim appearance on a suitable touch device. A narrow desktop viewport alone does not activate all mobile/coarse-pointer configuration.

## Performance observations

Measure playback, not just a paused image. Paused lab frames omit simulation work, while a manual 15-step batch performs much more simulation work in one rendered frame than normal playback. Neither is a representative steady-state frame-time sample.

Use the development frame/GPU diagnostics at matched viewport, device pixel ratio, bowl density, scene, and playback state. Record the browser and hardware and whether GPU timer queries are available. Include production playback with currents and jets before drawing conclusions about the complete experience. Compact contact patches, shared normal data, and removing duplicate wave generation reduce specific work, but do not by themselves establish a measured frame-rate gain.

## Limits of the current model and review

- The rendered water surface is geometrically flat. Height fields drive shading and distortion, not a displaced surface silhouette.
- Bowl reflections use mirrored geometry and procedural distortion; the studio environment is procedural, not a full reflection of scene lighting and geometry.
- Bowl motion uses a lightweight CPU collision model. There is no full fluid–rigid-body coupling, wave-driven buoyancy solution, or GPU-to-CPU height readback.
- Contact sampling assumes upright bowls. The intro's small shudder is visual; it does not solve a tilted hull's full waterline.
- Floor shadows and caustics are shading approximations. They should support contact without reading as opaque discs or duplicated wave outlines.
- The lab's scripted drag and disabled currents/jets do not replace production interaction review, mobile testing, or audio checks.
- Desktop Chrome visual review covered all six lab scenes, all four camera presets, production currents/jets, and a production drag after the shell-picking fix. Mobile-device performance, touch gestures, and the complete intro/audio sequence were not validated in this iteration.

## Recorded iteration — 2026-09-06

The isolated Ripple scene at frame 45 exposed an irregular luminous surface ring plus a separate offset floor ring. Replacing stacked analytic effects with one simulated packet, signed-height normals, and reflected studio lighting removed that duplication. A narrower impulse improved the crest/trough definition. Low and Top checks then guided the overhead reflection response.

Drag and stop was inspected at frames 60 and 90: the hull produced a continuous wake while moving, and the detached disturbance persisted after motion stopped. Both collision scenes registered one impact by frame 45 and showed a spreading disturbance. The 100-bowl Crowd scene was also inspected during playback.

At a 1440 × 696 CSS viewport and DPR 2 in desktop Chrome, sampled Crowd diagnostics showed roughly 7–8 ms GPU time and 12 draw calls during playback. These are observations from this machine, not an averaged benchmark or a before/after speed claim. Production currents/jets were checked separately; running a second rendering window affected frame pacing. The code validation passed with 87 tests.
