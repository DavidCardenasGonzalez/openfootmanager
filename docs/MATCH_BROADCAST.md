# Match broadcast framing and kits

The live match and Match Lab share the Canvas 2D renderer in `match-lab/src/renderer/`.
Simulation coordinates, replay timing, projection, pixel rasterization and painter order remain unchanged.

## Framing

`actionCamera.ts` projects the **interpolated ground position** of the ball to `focus`.
For each screen axis, with viewport center `c` and size `s`:

```
zoom = 1.85
tracked = c + (focus - c) * 0.85
translation = clamp(c - tracked * zoom, s * (1 - zoom), 0)
screen = projected * zoom + translation
```

Previously zoom was 1.25 and tracking weight was 0.4. Actors are now 48% larger;
the pitch can extend beyond the frame. Stadium layers are cropped by the same transform,
so the skyline and terraces take less space without changing the existing art.
The clamp prevents revealing unpainted canvas at the edges. The ball's height does not
move the camera up and down during a pass.

Camera motion uses the existing replay interpolation, without accumulated camera state
or an extra delay: pause, stepping and seeking give reproducible positions. Debug coordinates
and reduced-motion preferences retain the fixed full-field camera. Player name/rating overlays
use the same transform; goal announcements stay in screen space.

## Data and uniforms

`world.json → domain::Team.kits → gameState.teams → LiveMatchView → MatchCanvas → drawPlayer`.
The renderer finds both clubs by the snapshot's team IDs. Kit data stays outside the engine.
`TeamKits` and `TeamKit` preserve the existing JSON shape and default missing fields for older
worlds. Database migration 47 and both team repository read paths preserve kits across saves.
Older saves without kits fall back to the club's existing `colors` and `kit_pattern`; they do
not acquire away kits retroactively from a separate world file.

The local side uses `kits.home`, the visiting side uses its own `kits.away`.
`kits.ts` validates six-digit hex colors and resolves presentation fallbacks. If the primary
RGB distance is below 110, it tries the visitor's home kit; if that also clashes it uses a
light or dark contrasting shirt. This deliberately simple heuristic never edits stored kits.
Missing or invalid colors use the existing renderer palette.

The Solid sprite has a primary shirt and socks, secondary shorts, hem and shoulder piping,
and a light/dark number chosen for readability. Goalkeepers retain their distinct existing
palette because the source only defines outfield home/away kits. `spriteKit` is the pattern
extension point; other patterns currently render as Solid.

Match Lab reads the first two clubs from `data/open-manager/world.json` in its Vite config
and embeds only their resolved kits. It does not ship the full world/player database.
Its scoreboard swatches use those colors; its mock replay and generic side labels remain.

## Changed files

- `match-lab/src/renderer/actionCamera.ts`: closer framing and stronger tracking.
- `match-lab/src/renderer/kits.ts`: kit selection, contrast, validation and sprite colors.
- `match-lab/src/renderer/playerRenderer.ts`: apply kit colors and legible shirt numbers.
- `match-lab/src/renderer/MatchCanvas.tsx`: pass kits to each actor.
- `src/components/match/LiveMatchView.tsx`, `src/store/types.ts`: read real club kits.
- `src-tauri/crates/domain/src/team.rs`: optional home/away kit data.
- `src-tauri/crates/db/src/repositories/team_repo.rs`, `migrations.rs`,
  `sql/v047_team_kits.sql`: SQLite persistence and migration.
- `match-lab/vite.config.ts`, `src/env.d.ts`, `src/App.tsx`, `src/components/MatchHud.tsx`,
  `package.json`, `package-lock.json`: world kits in the standalone demo and build typing.
- Co-located camera/kit tests, `LiveMatchView.test.tsx`, and team repository tests:
  framing boundaries, selection/fallbacks, team-ID wiring and actual world JSON round-trip.

## Native rendering detail

The shared match framebuffer is now **1120 × 800** (previously 560 × 400): four times
the actual pixel count, with the same CSS dimensions, camera and player silhouette sizes.
`projection.ts` keeps the logical field coordinates unchanged and uses `pixelScale: 1`.

`sceneLayer.ts` renders static geometry directly to **2240 × 1600** caches (2× logical
resolution), enough for the existing 1.85× camera without magnifying coarse field pixels.
These are generated once per mounted canvas. Both layer and final canvas contexts disable
image smoothing; CSS still uses pixelated scaling. No blur filter or upscaled bitmap asset
is introduced. Static cache memory rises to about 27.3 MiB for two RGBA layers; the final
framebuffer is about 3.4 MiB. The density is fixed to keep cost predictable across devices.

Procedural asset refinements:

- `playerRenderer.ts` / `palette.ts`: native one-pixel fabric edges, sleeve/sock cuffs,
  separated shorts, boot highlights and face shading, preserving the clear number area.
  The existing 2× sprite transform and overall sizes are unchanged; half-unit local details
  now occupy real logical pixels.
- `ballRenderer.ts`: stepped round silhouette, shaded edge and small rotating panel seams,
  with a thinner readability ring. The existing maximum ball size is unchanged.
- `pitchRenderer.ts`: finer, lower-contrast turf flecks; existing field geometry is rasterized
  at higher resolution. Goal roofs and side faces now have intersecting mesh strands,
  with outlined posts separating them from the net.
- Stadium art remains unchanged and cached, without added crowd/skyline detail.

Resolution/cache behavior is covered by `sceneLayer.test.ts`; the live-view test checks the
actual canvas backing dimensions. Existing replay, framing, kit and player-label tests remain.

### Silhouette and environment refinement

The next detail pass retains all framebuffer, sprite scale and camera settings. Players gain
stepped shoulders, a visible neck, narrower wrists and separate shorts legs instead of a solid
rectangle. Contact shadows are slightly tighter. Pitch stripes have a little more contrast and
markings use a lighter chalk color. Corner flags have a one-pixel pole highlight and a stepped
cloth edge. Spectators snap to whole logical pixels, use simple clothing/jaw shading and a muted
palette; their count and the size of the stadium remain unchanged.

## Reference-quality figure redesign

The articulated figure renderer supersedes the earlier rectangular sprite refinements.
`playerPose.ts` calculates knees, ankles, elbows and hands from a deterministic 640 ms stride,
with opposing arm motion, directional strikes and raised arms. `pixelFigure.ts` rasterizes
limbs and faceted polygons into integer one-pixel rows, avoiding filtered vector strokes.
`playerRenderer.ts` draws this anatomy at native scale: approximately 52 pixels tall, with a
12-pixel head, tapered shirt, separate shorts, longer legs, kit highlights and directional face.
It no longer doubles a coarse sprite. Existing event timing, celebration hops and goalkeeper
dives still drive the figure; player labels and match coordinates remain unchanged.

The field now uses 10,500 seeded, irregular grass clusters at two spatial scales. They render
only when the static layer is created, never per animation frame. A greener turf palette and
subtle light/dark variation preserve broad mowing bands and clean markings. The reference
image guides proportions and material richness; no pixels or generated assets were copied.

Tests cover stride periodicity, stable idle poses, striking/raised limbs and integer-row
rasterization, alongside the existing camera, kits, resolution and replay tests.

### Running gait correction

Running feet remain in separate hip lanes (maximum lateral travel 2.5 native pixels),
with knees following the foot instead of bending in the opposite direction. Travel follows
the projected heading, and the returning foot lifts during recovery. Elbows stay close and
hands swing opposite the legs. Torso bob uses the same stride clock with an amplitude below
one pixel. Tests sweep the full cycle to prevent crossed feet and flared arms from returning.
