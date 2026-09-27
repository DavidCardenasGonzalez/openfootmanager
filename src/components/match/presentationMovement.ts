import type { PlayerState, Position, Team } from "../../../match-lab/src/match/types";

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
): Map<string, (fraction: number) => Position> {
  const sign = attackingTeam === "home" ? 1 : -1;
  const defenders = origin
    .filter((p) => p.team !== attackingTeam && !p.goalkeeper)
    .sort(
      (a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y),
    );
  return new Map(
    formation.map((base, index) => {
      const from = origin.find((p) => p.id === base.id) ?? base;
      // Both teams slide toward the active lane; distant players retain their formation.
      let x = base.x + (focus.x - 50) * 0.24;
      let y = base.y + (focus.y - 34) * 0.3;
      const nearby = Math.hypot(from.x - focus.x, from.y - focus.y) < 32;
      if (base.goalkeeper) {
        x = base.team === "home" ? 5 : 95;
        y = 34 + (focus.y - 34) * 0.22;
      } else if (base.id === receiverId) {
        x = focus.x + sign * 10;
        y = focus.y < 34 ? focus.y + 12 : focus.y - 12;
      } else if (base.team === attackingTeam && base.id !== actorId) {
        x += sign * (nearby ? 7 : 2);
        y += (base.y < focus.y ? -1 : 1) * (nearby ? 4 : 1.5);
      } else if (defenders[0]?.id === base.id || defenders[1]?.id === base.id) {
        x = focus.x + sign * (defenders[0]?.id === base.id ? 5 : 10);
        y = focus.y + (base.y < focus.y ? -4 : 4);
      }
      const dx = clamp(x, 3, 97) - from.x;
      const dy = clamp(y, 4, 64) - from.y;
      const distance = Math.hypot(dx, dy);
      const delay = base.id === receiverId ? 0 : (index % 4) * 0.035;
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
