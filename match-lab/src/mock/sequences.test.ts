import { expect, it } from "vitest";
import { sequences } from "./sequences";
import { demoReplay } from "./demoReplay";
import { PlaybackController } from "../match/playbackController";
import { sampleReplay } from "../match/interpolation";

it("preserves the original replay and gives the counterattack its own timeline", () => {
  expect(sequences.attackingGoal.replay).toBe(demoReplay);
  const replay = sequences.counterAttackSave.replay;
  expect(replay.id).not.toBe(demoReplay.id);
  expect(replay.events.map((e) => e.kind)).toEqual([
    "shortPass",
    "interception",
    "counterAttack",
    "throughBall",
    "dribble",
    "shot",
    "save",
  ]);
  expect(replay.durationMs).not.toBe(demoReplay.durationMs);
  const final = sampleReplay(replay, replay.durationMs);
  expect(final.event?.kind).toBe("save");
  expect(final.frame.score).toEqual({ home: 0, away: 0 });
  expect(final.frame.ball.ownerId).toBe("a1");
});
it("feeds every sequence through the same clock, sampler, and frame contract", () => {
  for (const { replay } of Object.values(sequences)) {
    const clock = new PlaybackController(replay);
    expect(clock.playing).toBe(false);
    expect(clock.timeMs).toBe(0);
    clock.play();
    clock.tick(2500);
    expect(sampleReplay(replay, clock.timeMs).frame.timeMs).toBe(2500);
    clock.step();
    expect(clock.playing).toBe(false);
    expect(replay.frames.at(-1)?.timeMs).toBe(replay.durationMs);
    for (const [i, frame] of replay.frames.entries()) {
      expect(frame.players).toHaveLength(22);
      expect(new Set(frame.players.map((p) => p.id)).size).toBe(22);
      if (i) expect(frame.timeMs).toBeGreaterThan(replay.frames[i - 1].timeMs);
      if (frame.ball.ownerId)
        expect(frame.players.some((p) => p.id === frame.ball.ownerId)).toBe(true);
    }
  }
});

it("transfers possession on interception and save without awarding a goal", () => {
  const replay = sequences.counterAttackSave.replay;
  expect(sampleReplay(replay, 0).frame.ball.ownerId).toBe("a8");
  expect(sampleReplay(replay, 1499).frame.ball.ownerId).toBeUndefined();
  expect(sampleReplay(replay, 1500).frame.ball.ownerId).toBe("h6");
  expect(sampleReplay(replay, 6800).frame.ball.ownerId).toBeUndefined();
  expect(sampleReplay(replay, 9300).frame.ball.ownerId).toBe("h9");
  expect(sampleReplay(replay, 12199).event?.kind).toBe("shot");
  expect(sampleReplay(replay, 12200).frame.ball.ownerId).toBe("a1");
  for (const frame of replay.frames) {
    expect(frame.score).toEqual({ home: 0, away: 0 });
    for (const player of frame.players) {
      expect(player.x).toBeGreaterThanOrEqual(0);
      expect(player.x).toBeLessThanOrEqual(100);
      expect(player.y).toBeGreaterThanOrEqual(0);
      expect(player.y).toBeLessThanOrEqual(68);
    }
  }
});

it("records the save against the attacking side, as the Rust engine does", () => {
  const save = sequences.counterAttackSave.replay.events.find((e) => e.kind === "save");
  expect(save?.team).toBe("home");
  expect(save?.from).toBe(9);
  expect(
    sequences.counterAttackSave.replay.frames.find((f) => f.timeMs === 12200)?.ball.ownerId,
  ).toBe("a1");
});
