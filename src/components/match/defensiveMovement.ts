import type { PlayerState, Position, Team } from "../../../match-lab/src/match/types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);

/** Visual responsibilities only: the engine remains authoritative for every outcome.
 * Keep assignments and velocity through a clip so nearby defenders do not swap jobs
 * on every frame. All movement starts at the previous displayed position. */
export function createDefensiveMovement(formation: readonly PlayerState[]) {
  const slots = new Map(formation.map((p) => [p.id, p]));
  const assignments = new Map<Team, { presser?: string; cover?: string }>();
  const velocities = new Map<string, Position>();

  return (
    previous: readonly PlayerState[],
    ball: Position,
    attackingTeam: Team,
    elapsedMs: number,
  ): Map<string, Position> => {
    const defendingTeam = attackingTeam === "home" ? "away" : "home";
    const sign = attackingTeam === "home" ? 1 : -1;
    const focus = { x: clamp(ball.x, 5, 95), y: clamp(ball.y, 4, 64) };
    const defenders = previous.filter(
      (p) => p.team === defendingTeam && !p.goalkeeper && slots.has(p.id),
    );
    const positions = new Map<string, Position>();
    if (!defenders.length) return positions;
    for (const p of previous) {
      if (p.team === attackingTeam) velocities.delete(p.id);
    }
    const jobs = assignments.get(defendingTeam) ?? {};
    // A small advantage is insufficient to hand the press to another player.
    const choose = (candidates: readonly PlayerState[], target: Position, current?: string) =>
      [...candidates].sort(
        (a, b) =>
          distance(a, target) -
          (a.id === current ? 4 : 0) -
          (distance(b, target) - (b.id === current ? 4 : 0)),
      )[0];
    const presser = choose(defenders, focus, jobs.presser);
    const goal = { x: sign === 1 ? 100 : 0, y: 34 };
    const goalDistance = distance(focus, goal);
    const pressTarget = {
      x: focus.x + ((goal.x - focus.x) / goalDistance) * 2.5,
      y: focus.y + ((goal.y - focus.y) / goalDistance) * 2.5,
    };
    // Cover sits behind the press on the route toward goal, away from the touchline.
    const coverTarget = {
      x: focus.x + sign * 10,
      y: focus.y + (34 - focus.y) * 0.45,
    };
    coverTarget.x = clamp(coverTarget.x, 6, 94);
    const cover = choose(
      defenders.filter((p) => p.id !== presser.id),
      coverTarget,
      jobs.cover,
    );
    assignments.set(defendingTeam, { presser: presser.id, cover: cover?.id });

    const progress = sign === 1 ? focus.x : 100 - focus.x;
    const blockCentre = clamp(progress + 12, 48, 77);
    const seconds = Math.max(0, elapsedMs) / 1000;
    for (const p of defenders) {
      const base = slots.get(p.id) ?? p;
      const baseDepth = sign === 1 ? base.x : 100 - base.x;
      const depth = blockCentre + (baseDepth - 65) * 0.58;
      const target =
        p.id === presser.id
          ? pressTarget
          : p.id === cover?.id
            ? coverTarget
            : {
                x: sign === 1 ? depth : 100 - depth,
                // Narrow the far side while retaining the formation's lateral order.
                y: 34 + (base.y - 34) * 0.68 + (focus.y - 34) * 0.3,
              };
      const dx = clamp(target.x, 3, 97) - p.x;
      const dy = clamp(target.y, 4, 64) - p.y;
      const remaining = Math.hypot(dx, dy);
      const speed = Math.min(8, remaining * 3);
      const desired =
        remaining > 0
          ? { x: (dx / remaining) * speed, y: (dy / remaining) * speed }
          : { x: 0, y: 0 };
      const old = velocities.get(p.id) ?? { x: 0, y: 0 };
      const blend = 1 - Math.exp(-seconds / 0.18);
      const velocity = {
        x: old.x + (desired.x - old.x) * blend,
        y: old.y + (desired.y - old.y) * blend,
      };
      const travel = Math.hypot(velocity.x, velocity.y) * seconds;
      const scale = travel > remaining && travel > 0 ? remaining / travel : 1;
      positions.set(p.id, {
        x: clamp(p.x + velocity.x * seconds * scale, 3, 97),
        y: clamp(p.y + velocity.y * seconds * scale, 4, 64),
      });
      velocities.set(p.id, velocity);
    }
    return positions;
  };
}
