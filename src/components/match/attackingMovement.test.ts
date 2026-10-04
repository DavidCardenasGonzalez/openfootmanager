import { expect, it } from "vitest";
import type { PlayerState } from "../../../match-lab/src/match/types";
import { attackingRuns } from "./attackingMovement";
import { supportingPaths } from "./presentationMovement";
const player = (id: string, x: number, y: number): PlayerState => ({
  id,
  x,
  y,
  team: "home",
  goalkeeper: false,
  shirtNumber: 1,
  direction: 0,
  action: "idle",
});
const formation = [
  player("back", 18, 20),
  player("support", 44, 14),
  player("late", 44, 40),
  player("runner", 70, 45),
  player("actor", 70, 14),
];
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing movement");
  return value;
}
const paths = () =>
  supportingPaths(formation, formation, { x: 75, y: 14 }, "home", "actor", undefined, 16000);
it("offers a short support, a forward run and one delayed midfield arrival while retaining cover", () => {
  const movement = paths();
  const support = required(movement.get("support"))(1);
  const runner = required(movement.get("runner"))(1);
  const late = required(movement.get("late"))(1);
  expect(support.x).toBeLessThan(75);
  expect(support.x).toBeGreaterThan(60);
  expect(runner.x).toBeGreaterThan(82);
  expect(late.x).toBeGreaterThanOrEqual(82);
  expect(Math.abs(runner.y - late.y)).toBeGreaterThanOrEqual(8);
  expect(required(movement.get("back"))(1).x).toBeLessThan(40);
  expect(required(movement.get("late"))(0.15)).toEqual({ x: 44, y: 40 });
});
it("does not send a midfielder into the box during buildup or when play is stopped", () => {
  for (const [focus, inPlay] of [
    [{ x: 25, y: 14 }, true],
    [{ x: 75, y: 14 }, false],
  ] as const) {
    const movement = supportingPaths(
      formation,
      formation,
      focus,
      "home",
      "actor",
      undefined,
      16000,
      inPlay,
    );
    expect(required(movement.get("late"))(1).x).toBeLessThan(65);
  }
});
it("keeps runs reproducible, continuous, bounded and mirrored for away attacks", () => {
  const mirror = formation.map((p) => ({ ...p, team: "away" as const, x: 100 - p.x, y: 68 - p.y }));
  const home = paths();
  const away = supportingPaths(mirror, mirror, { x: 25, y: 54 }, "away", "actor", undefined, 16000);
  for (const p of formation) {
    expect(required(home.get(p.id))(0)).toEqual({ x: p.x, y: p.y });
    let previous = required(home.get(p.id))(0);
    for (let i = 1; i <= 100; i++) {
      const current = required(home.get(p.id))(i / 100);
      const other = required(away.get(p.id))(i / 100);
      expect(other.x).toBeCloseTo(100 - current.x);
      expect(other.y).toBeCloseTo(68 - current.y);
      expect(Math.hypot(current.x - previous.x, current.y - previous.y) / 0.16).toBeLessThanOrEqual(
        8.01,
      );
      expect(current).toEqual(required(paths().get(p.id))(i / 100));
      previous = current;
    }
  }
});

it("chooses a different forward lane when the preferred one is occupied by a defender", () => {
  const focus = { x: 75, y: 14 };
  const clear = attackingRuns(formation, formation, focus, "home", "actor");
  const target = required(clear.get("runner"));
  const opponent = { ...player("opponent", target.x, target.y), team: "away" as const };
  const crowded = attackingRuns(formation, [...formation, opponent], focus, "home", "actor");
  expect(Math.abs(required(crowded.get("runner")).y - target.y)).toBeGreaterThanOrEqual(8);
});

it("leaves the designated receiver and keeper to the replay and tolerates missing teammates", () => {
  const keeper = { ...player("keeper", 5, 34), goalkeeper: true };
  const squad = [...formation, keeper];
  const runs = attackingRuns(squad, squad, { x: 75, y: 14 }, "home", "actor", "runner");
  expect(runs.has("runner")).toBe(false);
  expect(runs.has("actor")).toBe(false);
  expect(runs.has("keeper")).toBe(false);
  expect(attackingRuns([], [], { x: 75, y: 14 }, "home", "actor").size).toBe(0);
});
