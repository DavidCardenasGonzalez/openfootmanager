import { describe, expect, it } from "vitest";
import type { PlayerState, Position } from "../../../match-lab/src/match/types";
import { createDefensiveMovement } from "./defensiveMovement";

const player = (id: string, x: number, y: number, goalkeeper = false): PlayerState => ({
  id,
  x,
  y,
  goalkeeper,
  team: "away",
  shirtNumber: 1,
  direction: Math.PI,
  action: "idle",
});
const formation = [
  player("keeper", 95, 34, true),
  player("near", 72, 14),
  player("cover", 80, 25),
  player("centre", 82, 41),
  player("far", 82, 55),
  player("mid", 56, 34),
];

function settle(focus: Position, seconds = 8) {
  const move = createDefensiveMovement(formation);
  let positions = formation;
  for (let i = 0; i < seconds * 20; i++) {
    const next = move(positions, focus, "home", 50);
    positions = positions.map((p) => ({ ...p, ...(next.get(p.id) ?? p) }));
  }
  return positions;
}
const get = (players: readonly PlayerState[], id: string) => {
  const result = players.find((p) => p.id === id);
  if (!result) throw new Error(`Missing ${id}`);
  return result;
};

describe("collective defensive movement", () => {
  it("sends one defender to the ball and keeps cover deeper and toward the centre", () => {
    const focus = { x: 70, y: 12 };
    const result = settle(focus);
    const presser = get(result, "near");
    const cover = get(result, "cover");
    expect(Math.hypot(presser.x - focus.x, presser.y - focus.y)).toBeLessThan(4);
    expect(cover.x - presser.x).toBeGreaterThan(4);
    expect(cover.y).toBeGreaterThan(presser.y + 3);
    expect(
      result.filter((p) => !p.goalkeeper && Math.hypot(p.x - focus.x, p.y - focus.y) < 5),
    ).toHaveLength(1);
    expect(get(result, "keeper")).toEqual(formation[0]);
  });

  it("tucks the far side in and retreats the back line as the attack approaches goal", () => {
    const wide = settle({ x: 70, y: 12 });
    expect(get(wide, "far").y).toBeLessThan(46);
    expect(get(wide, "far").y).toBeGreaterThan(30);
    const shallow = settle({ x: 50, y: 12 });
    const deep = settle({ x: 85, y: 12 });
    expect(get(deep, "far").x - get(shallow, "far").x).toBeGreaterThan(7);
    expect(get(deep, "centre").x).toBeGreaterThan(get(shallow, "centre").x);
  });

  it("reacts to a switch of play without teleporting or moving the goalkeeper", () => {
    const move = createDefensiveMovement(formation);
    let previous = settle({ x: 70, y: 12 });
    const start = get(previous, "far");
    for (let i = 0; i < 120; i++) {
      const positions = move(previous, { x: 75, y: 58 }, "home", 50);
      const next = previous.map((p) => ({ ...p, ...(positions.get(p.id) ?? p) }));
      for (const p of next) {
        const old = get(previous, p.id);
        expect(Math.hypot(p.x - old.x, p.y - old.y)).toBeLessThanOrEqual(8 * 0.05 + 1e-9);
        expect(p.x).toBeGreaterThanOrEqual(3);
        expect(p.x).toBeLessThanOrEqual(97);
        expect(p.y).toBeGreaterThanOrEqual(4);
        expect(p.y).toBeLessThanOrEqual(64);
      }
      previous = next;
    }
    expect(get(previous, "far").y).toBeGreaterThan(start.y + 8);
    expect(get(previous, "keeper")).toEqual(formation[0]);
  });

  it("mirrors the same behaviour for either team and is deterministic", () => {
    const mirror = (p: PlayerState): PlayerState => ({
      ...p,
      team: "home",
      x: 100 - p.x,
      y: 68 - p.y,
    });
    const mirrored = formation.map(mirror);
    const home = createDefensiveMovement(formation);
    const away = createDefensiveMovement(mirrored);
    let a = formation;
    let b = mirrored;
    for (let i = 0; i < 100; i++) {
      const pa = home(a, { x: 70, y: 12 }, "home", 50);
      const pb = away(b, { x: 30, y: 56 }, "away", 50);
      a = a.map((p) => ({ ...p, ...(pa.get(p.id) ?? p) }));
      b = b.map((p) => ({ ...p, ...(pb.get(p.id) ?? p) }));
      a.forEach((p) => {
        expect(get(b, p.id).x).toBeCloseTo(100 - p.x);
        expect(get(b, p.id).y).toBeCloseTo(68 - p.y);
      });
    }
    expect(settle({ x: 70, y: 12 })).toEqual(settle({ x: 70, y: 12 }));
  });

  it("handles depleted teams, possession changes and zero time without mutating inputs", () => {
    const lone = [formation[0], formation[1]];
    const before = structuredClone(lone);
    const move = createDefensiveMovement(lone);
    expect(move(lone, { x: 90, y: 1 }, "home", 0).get("near")).toEqual({ x: 72, y: 14 });
    expect(move(lone, { x: 90, y: 1 }, "away", 50).size).toBe(0);
    const positions = move(lone, { x: 90, y: 1 }, "home", 50);
    expect(Number.isFinite(positions.get("near")?.x)).toBe(true);
    expect(lone).toEqual(before);
    expect(createDefensiveMovement([])([], { x: 50, y: 34 }, "home", 50).size).toBe(0);
  });
});
