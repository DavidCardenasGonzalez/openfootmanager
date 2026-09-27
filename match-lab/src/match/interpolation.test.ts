import { expect, it } from "vitest";
import { interpolateFrames, sampleReplay } from "./interpolation";
import { demoReplay } from "../mock/demoReplay";

it("matches reordered players by ID and interpolates orientations across the short arc", () => {
  const a = structuredClone(demoReplay.frames[0]);
  const players = a.players.map((p) => ({ ...p, direction: Math.PI - 0.1 }));
  const b = {
    ...a,
    timeMs: 100,
    players: [...players].reverse().map((p) => ({ ...p, x: p.x + 2, direction: -Math.PI + 0.1 })),
  };
  const sample = interpolateFrames({ ...a, players }, b, 50);
  expect(sample.players[0].id).toBe(players[0].id);
  expect(sample.players[0].x).toBeCloseTo(players[0].x + 1);
  expect(sample.players[0].direction).toBeCloseTo(Math.PI);
});

it("clamps seeks to endpoint frames and never interpolates score changes early", () => {
  expect(sampleReplay(demoReplay, -100).frame.timeMs).toBe(0);
  const final = sampleReplay(demoReplay, 90000);
  expect(final.frame.timeMs).toBe(demoReplay.durationMs);
  expect(final.alpha).toBe(0);
  const goal = sampleReplay(demoReplay, 24999);
  expect(goal.frame.score.home).toBe(0);
  expect(goal.event?.kind).toBe("shot");
});
