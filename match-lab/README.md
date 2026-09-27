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

The sequence dropdown keeps the original **Existing attacking sequence** selected
by default. Press Play for its 40-second deterministic sequence: kickoff, repositioning, short
pass, lofted long pass, dribble, defensive pressure, attacking combination, shot,
goal celebration, return to formation, and an away kickoff setup. It stops at the
end; Play starts it again. Pause freezes everything, including running animation.
Reset returns to 0–0 and pauses; it preserves the selected playback speed.

The second option, **Interception → Counter attack → Through ball → Save**, is a
separate 16-second replay ending with the goalkeeper holding the ball at 0–0.
Changing sequence pauses and resets the shared viewer, clock, speed, score, and
debug state. The language selection stays unchanged. The timeline and frame
inspector always use the selected replay; the inspector includes its `replayId`.

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
- `src/mock/sequences.ts`: sequence registry (`labelKey` + `ReplayData`).
- `src/mock/demoReplay.ts`: original authored cues generate 401 snapshots at 10 Hz.
- `src/mock/counterAttackReplay.ts`: separate counterattack snapshots, sampled with
  the same interpolation function; no second player or animation engine.
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
  and wires controls to the viewer. `selectedSequence` chooses a registry entry;
  React mounts the same `MatchLab` with that key, cleaning up the previous animation
  loop and initializing a new clock. The language lives outside this keyed viewer.

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

## Adding another test sequence

1. Export a `ReplayData` object from a new file under `src/mock/`. It contains
   ordered frames and events, not a React component. Keep the frame contract above.
2. Add its title key to every `src/i18n/locales/*.json` file.
3. Add `{ labelKey, replay }` to `sequences` in `src/mock/sequences.ts`. The dropdown,
   timeline, inspector, and playback controls pick it up automatically.
4. If the sequence introduces an event kind, add that kind to `EventKind` and its
   translated event label. Existing event kinds and controls can be reused.

Crosses, corners, fouls, rebounds, and other future sequences can use this same
registration path; they are not implemented by the two current demos.

## Relationship to the Rust match engine

The demos are authored presentation data, not engine output. The Rust engine's
`MatchEvent` records a match **minute**, event type, side, one or two player IDs,
and one of five pitch zones. Its `MatchSnapshot` has score, possession, ball
zone, and squads, but no continuous player or ball coordinates. A future adapter
will need to create presentation positions and timestamps while keeping match
outcomes faithful to those events. Match Lab does not call Tauri or Rust today.

Use engine events as the source for future scene design:

- `Interception`, `Tackle`, `DribbleTackled`, `Cross`, `Corner`, `Foul`,
  `FreeKick`, `ShotOnTarget`, `ShotSaved`, `ShotBlocked`, `Goal`, and `GoalKick`
  are explicit Rust event types.
- **Counter attack**, **through ball**, **header**, and **rebound** are not distinct
  engine event types. They can only be presentation interpretations where the
  event chain supports them. In particular, a blocked shot currently leads to a
  defensive clearance to midfield, so a same-attack rebound would need engine
  support before it could be shown as a real match outcome.
- `ShotSaved` belongs to the **shooting side** and identifies the shooter. The
  defensive goalkeeper may catch it (`GoalKick` follows) or parry it for a
  `Corner`. The counterattack demo shows the catch outcome. Its save event now
  follows the shooting-side convention; the goalkeeper's possession remains in
  the frame data.

Design new sequences against this list before treating them as candidates for
real-match playback. An animation may be authored as a visual prototype without
claiming that the current engine produced its result.

### Application integration

The application's `MatchLive` screen now defaults to the match view and retains
Events, Stats and Lineups. `src/components/match/livePresentation.ts` translates
new Rust snapshot events into the existing replay contract; `LiveMatchView.tsx`
uses the same playback controller, interpolation and Canvas renderer as this lab.
The application does not import the mock sequences. The lab still runs independently.

Engine IDs, XI slots, substitutions, dismissals, scores and event outcomes are
preserved. Movement is an illustrative reconstruction from zones, not continuous
tracking data from Rust. Unmapped events receive neutral staging. The existing
penalty shootout screen remains separate. Presentation speeds are 8/4/1 seconds
per simulated minute (slow/normal/fast); instant retains the ten-minute batches.
