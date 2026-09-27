import { describe, expect, it } from "vitest";
import { PlaybackController } from "./playbackController";
import { sampleReplay } from "./interpolation";
import { demoReplay } from "../mock/demoReplay";

describe("playback", () => {
  it("starts paused, respects speed, pauses, clamps at end and resets", () => {
    const c = new PlaybackController(demoReplay);
    c.tick(1000);
    expect(c.timeMs).toBe(0);
    c.play();
    c.setSpeed(2);
    c.tick(1000);
    expect(c.timeMs).toBe(2000);
    c.pause();
    c.tick(500);
    expect(c.timeMs).toBe(2000);
    c.play();
    c.tick(100000);
    expect(c.timeMs).toBe(demoReplay.durationMs);
    expect(c.playing).toBe(false);
    c.reset();
    expect(c.timeMs).toBe(0);
    expect(c.playing).toBe(false);
  });
  it("steps to exactly the next recorded frame and pauses", () => {
    const c = new PlaybackController(demoReplay);
    c.play();
    c.seek(37);
    c.step();
    expect(c.timeMs).toBe(demoReplay.frames[1].timeMs);
    expect(c.playing).toBe(false);
    c.seek(-10);
    expect(c.timeMs).toBe(0);
    c.seek(Infinity);
    expect(c.timeMs).toBe(0);
  });
  it("interpolates positions without mutating source or advancing discrete events", () => {
    const before = JSON.stringify(demoReplay);
    const a = demoReplay.frames[60];
    const b = demoReplay.frames[61];
    const sample = sampleReplay(demoReplay, (a.timeMs + b.timeMs) / 2);
    expect(sample.frame.players[9].x).toBeCloseTo((a.players[9].x + b.players[9].x) / 2);
    expect(sample.frame.ball.x).toBeCloseTo((a.ball.x + b.ball.x) / 2);
    expect(sample.frame.score).toEqual(a.score);
    expect(JSON.stringify(demoReplay)).toBe(before);
  });
  it("updates the score on the goal boundary, and keeps it through reset", () => {
    const goal = demoReplay.events.find((e) => e.kind === "goal");
    if (!goal) throw new Error("Missing goal fixture");
    expect(sampleReplay(demoReplay, goal.timeMs - 1).frame.score.home).toBe(0);
    expect(sampleReplay(demoReplay, goal.timeMs).frame.score.home).toBe(1);
    expect(sampleReplay(demoReplay, demoReplay.durationMs).frame.score.home).toBe(1);
    expect(sampleReplay(demoReplay, goal.timeMs).event?.kind).toBe("goal");
  });
});
