# Match Lab

An independent browser sandbox inside OpenFootManager. React, TypeScript, Vite,
Tailwind, and Canvas 2D; no Tauri commands, Rust build, external artwork, or app imports.

## Run

Use Node.js 20.19+ or 22.12+ and npm. From the repository root:

```sh
cd match-lab
npm install
npm run dev
```

Open **http://localhost:5174** in a normal browser. Add `-- --open` to the last
command to open it automatically. Port 5174 is separate from the application's
1420 port. No installation at the repository root is needed.

```sh
npm test        # replay, interpolation, clock, and locale tests
npm run build   # TypeScript check and standalone dist/ output
npm run preview
```

## Try it

Press Play for a 40-second deterministic sequence: kickoff, repositioning, short
pass, lofted long pass, dribble, defensive pressure, attacking combination, shot,
goal celebration, return to formation, and an away kickoff setup. It stops at the
end; Play starts it again. Pause freezes everything, including running animation.
Reset returns to 0–0 and pauses; it preserves the selected playback speed.

Step pauses and advances to the next recorded frame (100 ms). Change speed from
0.5× through 4×. Scrub the slider, or click any event to pause and inspect it.
Toggle shirt numbers or a coordinate grid. Expand the frame inspector to compare
recorded and interpolated state, interpolation fraction, and the current event.
Switch among all twelve OpenFootManager languages using the language selector.
Hidden browser tabs suspend the replay clock.

## Boundaries

- `src/match/types.ts`: source-independent replay contract. Match-space units are
  x 0–100, y 0–68; the ball can cross the goal line. `direction` is radians and
  timestamps are replay milliseconds.
- `src/mock/demoReplay.ts`: authored cues generate 401 snapshots at 10 Hz.
- `src/match/playbackController.ts`: pure clock, seeking, stepping, and speed.
- `src/match/interpolation.ts`: samples snapshots by stable player ID without
  mutating them. Positions/heights and shortest-path orientations interpolate;
  scores, possession metadata, actions, and events change at recorded boundaries.
- `src/renderer/`: presentation only. A shared affine 3/4 projection maps the
  unchanged match coordinates into a 1120×800 scene, rasterized at 560×400 for
  crisp pixel edges. Upright procedural sprites and goal cages sort by projected
  ground depth. Stadium, crowd, and pitch layers are cached; only players, the
  ball, and presentation overlays redraw during playback.
- `src/App.tsx`: accepts `ReplayData` via `MatchLab`, drives browser animation,
  and wires controls to the viewer. Mount with `key={replay.id}` when replacing a replay.

Future data sources should produce ordered, nonempty frames with stable player
IDs, events sorted by timestamp, and a final frame at `durationMs`. No engine
adapter is implemented. The current Rust snapshots describe minute/zone state,
not continuous player positions, so they are deliberately not reused here.

The scene uses original procedural art: stepped crowd terraces, floodlights,
barriers, striped grass, upright nets, enlarged footballers, and distinct keeper
kits. Idle, run, pass, and shoot poses use replay time, so pausing and seeking also
freeze/reconstruct animation. The ball is drawn above overlapping actors to keep
it trackable; this intentionally favors readability over strict occlusion.

This is an authored visual demo, not football AI or a rules engine. The return to
kickoff is a simplified animated reset, and very small screens reduce number
legibility. Rendered JSON uses stable technical field names regardless of locale.
