import { expect, it } from "vitest";
import { PlaybackController } from "../../../match-lab/src/match/playbackController";
import type { ReplayData } from "../../../match-lab/src/match/types";
import { advanceLivePlayback } from "./livePlayback";

const replay: ReplayData = {
  id: "two-goals",
  durationMs: 8000,
  frames: [],
  events: [
    { id: "0", timeMs: 0, kind: "shot", team: "home" },
    { id: "0", timeMs: 1000, kind: "goal", team: "home" },
    { id: "1", timeMs: 4000, kind: "shot", team: "away" },
    { id: "1", timeMs: 5000, kind: "goal", team: "away" },
  ],
};
it("cannot skip a goal when an animation frame is delayed", () => {
  const clock = new PlaybackController(replay);
  clock.play();
  advanceLivePlayback(clock, 10000, 40);
  expect(clock.timeMs).toBe(1000);
  advanceLivePlayback(clock, 2200, 40);
  expect(clock.timeMs).toBe(3200);
  advanceLivePlayback(clock, 10000, 40);
  expect(clock.timeMs).toBe(5000);
});
it("keeps celebrations in real time at maximum speed and freezes while paused", () => {
  const clock = new PlaybackController(replay);
  clock.play();
  clock.seek(1000);
  advanceLivePlayback(clock, 1000, 40);
  expect(clock.timeMs).toBe(2000);
  clock.pause();
  advanceLivePlayback(clock, 1000, 40);
  expect(clock.timeMs).toBe(2000);
});
