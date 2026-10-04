import type { PlayerState, Position, Team } from "../../../match-lab/src/match/types";
import { attackingRuns } from "./attackingMovement";

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export const easeMovement = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

/** Small, deterministic staging rules, not tactical decisions. Roles never change possession. */
export function supportingPaths(
  formation: readonly PlayerState[],
  origin: readonly PlayerState[],
  focus: Position,
  attackingTeam: Team,
  actorId: string | undefined,
  receiverId: string | undefined,
  durationMs: number,
  inPlay = true,
): Map<string, (fraction: number) => Position> {
  const sign = attackingTeam === "home" ? 1 : -1;
  const runs =
    inPlay && actorId
      ? attackingRuns(formation, origin, focus, attackingTeam, actorId, receiverId)
      : undefined;
  return new Map(
    formation.map((base, index) => {
      const from = origin.find((p) => p.id === base.id) ?? base;
      // Outfield defenders are advanced frame by frame by defensiveMovement.
      if (base.team !== attackingTeam && !base.goalkeeper) {
        return [base.id, () => ({ x: from.x, y: from.y })];
      }
      let x = base.x + (focus.x - 50) * 0.24;
      let y = base.y + (focus.y - 34) * 0.3;
      const nearby = Math.hypot(from.x - focus.x, from.y - focus.y) < 32;
      const run = runs?.get(base.id);
      if (base.goalkeeper) {
        x = base.team === "home" ? 5 : 95;
        y = 34 + (focus.y - 34) * 0.22;
      } else if (base.id === receiverId) {
        x = focus.x + sign * 10;
        y = focus.y < 34 ? focus.y + 12 : focus.y - 12;
      } else if (run) {
        x = run.x;
        y = run.y;
      } else if (base.team === attackingTeam && base.id !== actorId) {
        x += sign * 2;
        y += (base.y === focus.y ? sign : base.y < focus.y ? -1 : 1) * (nearby ? 4 : 1.5);
      }
      const dx = clamp(x, 3, 97) - from.x;
      const dy = clamp(y, 4, 64) - from.y;
      const distance = Math.hypot(dx, dy);
      const delay = run?.delay ?? (base.id === receiverId ? 0 : (index % 4) * 0.035);
      // Quintic easing peaks at 1.875; account for the stagger to cap visual speed.
      const limit = ((((base.goalkeeper ? 3 : 8) * durationMs) / 1000) * (1 - delay)) / 1.875;
      const scale = distance > 0 ? Math.min(1, limit / distance) : 0;
      return [
        base.id,
        (fraction: number) => {
          const t = easeMovement((fraction - delay) / (1 - delay));
          return { x: from.x + dx * scale * t, y: from.y + dy * scale * t };
        },
      ];
    }),
  );
}
