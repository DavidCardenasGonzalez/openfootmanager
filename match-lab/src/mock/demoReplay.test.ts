import { expect, it } from "vitest";
import { createDemoReplay } from "./demoReplay";

it("provides a deterministic, complete replay with stable players and independent ball states", () => {
  const r = createDemoReplay();
  expect(r).toEqual(createDemoReplay());
  expect(r.durationMs).toBeGreaterThanOrEqual(30000);
  expect(r.frames.at(-1)?.timeMs).toBe(r.durationMs);
  for (const [i, f] of r.frames.entries()) {
    expect(f.players).toHaveLength(22);
    expect(new Set(f.players.map((p) => p.id)).size).toBe(22);
    expect(f.players.filter((p) => p.team === "home")).toHaveLength(11);
    if (i) expect(f.timeMs).toBeGreaterThan(r.frames[i - 1].timeMs);
    for (const p of f.players) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(68);
    }
    if (f.ball.ownerId) expect(f.players.some((p) => p.id === f.ball.ownerId)).toBe(true);
  }
  expect(r.events.map((e) => e.kind)).toEqual([
    "kickoff",
    "reposition",
    "shortPass",
    "longPass",
    "dribble",
    "pressure",
    "attack",
    "attack",
    "shot",
    "goal",
    "reset",
    "kickoff",
  ]);
});

it("keeps possession at the player feet and sends passes and shots independently", () => {
  const r = createDemoReplay();
  for (const frame of r.frames) {
    if (frame.ball.ownerId) {
      const owner = frame.players.find((p) => p.id === frame.ball.ownerId);
      if (!owner) throw new Error("Unknown ball owner");
      expect(Math.hypot(owner.x - frame.ball.x, owner.y - frame.ball.y)).toBeCloseTo(1);
    }
    if (frame.ball.motion === "pass" || frame.ball.motion === "shot") {
      expect(frame.ball.ownerId).toBeUndefined();
    }
  }
  expect(r.frames.some((f) => f.ball.height > 4)).toBe(true);
});
