import { expect, it } from "vitest";
import type { MatchFrame, PlayerState } from "../../../match-lab/src/match/types";
import { buildGoalCelebration } from "./goalCelebration";

const player = (id: string, x: number, y: number): PlayerState => ({
  id,
  x,
  y,
  team: "home",
  shirtNumber: 1,
  goalkeeper: false,
  direction: 0,
  action: "idle",
});
const frame = (players: PlayerState[]): MatchFrame => ({
  timeMs: 4000,
  matchTimeSeconds: 60,
  score: { home: 1, away: 0 },
  players,
  ball: { x: 102, y: 34, height: 0, motion: "goal" },
});
it("lets a teammate already in the huddle celebrate without a phantom run", () => {
  const start = frame([player("scorer", 82, 30), player("teammate", 87.5, 25)]);
  const frames = buildGoalCelebration(start, "home", "scorer", 14000);
  expect(frames.every((f) => f.players[1].action === "celebrate")).toBe(true);
  expect(frames.every((f) => f.players[1].x === 87.5 && f.players[1].y === 25)).toBe(true);
});
it("allows distant players enough running time and a shared two-second finish", () => {
  const start = frame([player("scorer", 98, 65), player("distant", 0, 0)]);
  const before = JSON.stringify(start);
  const frames = buildGoalCelebration(start, "home", "scorer", 14000);
  expect(frames[frames.length - 1].timeMs - start.timeMs).toBeGreaterThan(14000);
  expect(frames.slice(-20).every((f) => f.players.every((p) => p.action === "celebrate"))).toBe(
    true,
  );
  expect(JSON.stringify(start)).toBe(before);
  expect(buildGoalCelebration(start, "home", "scorer", 14000)).toEqual(frames);
});

it("lets nearby opponents walk away so they do not remain inside the celebrating team", () => {
  const opponent = { ...player("opponent", 84, 27), team: "away" as const };
  const start = frame([player("scorer", 82, 30), opponent]);
  const frames = buildGoalCelebration(start, "home", "scorer", 14000);
  expect(frames.some((f) => f.players[1].action === "walk")).toBe(true);
  const end = frames[frames.length - 1];
  expect(
    Math.hypot(end.players[1].x - end.players[0].x, end.players[1].y - end.players[0].y),
  ).toBeGreaterThan(10);
  for (let i = 1; i < frames.length; i++) {
    expect(Math.abs(frames[i].players[1].x - frames[i - 1].players[1].x) / 0.1).toBeLessThanOrEqual(
      3.21,
    );
  }
});
