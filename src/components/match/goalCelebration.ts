import type { MatchFrame, PlayerState, Team } from "../../../match-lab/src/match/types";

/** A staggered run with acceleration and braking, followed by a team huddle.
 * Coordinates are presentation only; the confirmed ball and score remain fixed. */
export function buildGoalCelebration(
  start: MatchFrame,
  team: Team,
  scorerId: string | undefined,
  minimumDurationMs: number,
): MatchFrame[] {
  const winners = start.players.filter((p) => p.team === team);
  const scorer = winners.find((p) => p.id === scorerId) ?? winners.find((p) => !p.goalkeeper);
  if (!scorer) return [{ ...start, timeMs: start.timeMs + minimumDurationMs }];
  const center = {
    x: Math.max(10, Math.min(90, scorer.x + (team === "home" ? 2 : -2))),
    y: Math.max(10, Math.min(58, scorer.y - 5)),
  };
  let slot = 0;
  const runs = new Map(winners.map((player) => {
    const index = player.id === scorer.id ? -1 : slot++;
    // Two rings leave room for separate sprites while keeping the team together.
    const ring = index < 6 ? 0 : 1;
    const count = ring === 0 ? Math.min(6, winners.length - 1) : winners.length - 7;
    const angle = count > 0 ? ((index % 6) / count) * Math.PI * 2 + ring * 0.4 : 0;
    const radius = index < 0 ? 0 : ring === 0 ? 3.5 : 6;
    const target = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    const distance = Math.hypot(target.x - player.x, target.y - player.y);
    const duration = distance / (player.goalkeeper ? 7 : 7.6) + 0.6;
    const ramp = Math.min(0.6, duration / 2);
    return [player.id, {
      target, distance, duration, ramp,
      peakSpeed: distance / (duration - ramp),
      delay: index < 0 ? 0 : 0.15 + index * 0.09,
    }] as const;
  }));
  const durationMs = Math.ceil(Math.max(minimumDurationMs,
    ...[...runs.values()].map((run) => (run.delay + run.duration + 2) * 1000),
  ) / 100) * 100;
  const frames: MatchFrame[] = [];
  for (let elapsed = 100; elapsed <= durationMs; elapsed += 100) {
    const players = start.players.map((player): PlayerState => {
      const run = runs.get(player.id);
      if (!run) return { ...player, action: "idle" };
      const time = Math.max(0, Math.min(run.duration, elapsed / 1000 - run.delay));
      const travel = time < run.ramp
        ? run.peakSpeed * time * time / (2 * run.ramp)
        : time <= run.duration - run.ramp
          ? run.peakSpeed * (time - run.ramp / 2)
          : run.distance - run.peakSpeed * (run.duration - time) ** 2 / (2 * run.ramp);
      const fraction = run.distance > 0 ? travel / run.distance : 1;
      const x = player.x + (run.target.x - player.x) * fraction;
      const y = player.y + (run.target.y - player.y) * fraction;
      const arrived = time >= run.duration;
      return {
        ...player, x, y,
        direction: arrived
          ? Math.atan2(center.y - y, center.x - x)
          : Math.atan2(run.target.y - player.y, run.target.x - player.x),
        action: arrived ? "celebrate" : time > 0 ? "run" : "idle",
      };
    });
    frames.push({ ...start, timeMs: start.timeMs + elapsed, players });
  }
  return frames;
}
