import type { PlayerState, Position, Team } from "../../../match-lab/src/match/types";

type Run = Position & { delay: number };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Choose a small set of complementary runs from deployed formation slots.
 * These destinations illustrate play; they never choose a pass or a scorer. */
export function attackingRuns(
  formation: readonly PlayerState[],
  origin: readonly PlayerState[],
  focus: Position,
  team: Team,
  actorId: string,
  receiverId?: string,
): Map<string, Run> {
  const normalize = (p: Position): Position =>
    team === "home" ? p : { x: 100 - p.x, y: 68 - p.y };
  const ball = normalize(focus);
  const runs = new Map<string, Run>();
  const available = formation.filter(
    (p) => p.team === team && !p.goalkeeper && p.id !== actorId && p.id !== receiverId,
  );
  const midfield = available.filter((p) => {
    const depth = normalize(p).x;
    return depth >= 35 && depth < 62;
  });
  // Select from the deployed slots to avoid changing jobs when runners advance.
  const support = [...midfield].sort(
    (a, b) => Math.abs(normalize(a).y - ball.y) - Math.abs(normalize(b).y - ball.y),
  )[0];
  const reserved: Position[] = [ball];
  if (receiverId) reserved.push({ x: ball.x + 10, y: ball.y < 34 ? ball.y + 12 : ball.y - 12 });
  const assign = (p: PlayerState, target: Position, delay: number) => {
    reserved.push(target);
    runs.set(p.id, { ...normalize(target), delay });
  };
  if (support && ball.x >= 40) {
    assign(
      support,
      {
        x: clamp(ball.x - 10, 30, 74),
        y: clamp(ball.y + (ball.y < 34 ? 10 : -10), 8, 60),
      },
      0.03,
    );
  }
  if (ball.x < 50) return runs;
  const runner = available
    .filter((p) => normalize(p).x >= 62)
    .sort((a, b) => Math.abs(normalize(a).y - ball.y) - Math.abs(normalize(b).y - ball.y))[0];
  const openLane = (p: PlayerState, x: number) => {
    const candidates = [14, 26, 42, 54].map((y) => ({ x, y }));
    const score = (target: Position) => {
      const crowding = origin
        .filter((q) => q.id !== p.id && !q.goalkeeper)
        .reduce((sum, q) => {
          const pos = normalize(q);
          return sum + Math.max(0, 12 - Math.hypot(target.x - pos.x, target.y - pos.y));
        }, 0);
      const overlap = reserved.reduce(
        (sum, q) => sum + Math.max(0, 10 - Math.hypot(target.x - q.x, target.y - q.y)) * 4,
        0,
      );
      return crowding + overlap + Math.abs(target.y - normalize(p).y) * 0.15;
    };
    return candidates.sort((a, b) => score(a) - score(b))[0];
  };
  if (runner) assign(runner, openLane(runner, clamp(ball.x + 14, 68, 91)), 0.06);
  // Only one midfielder arrives; deeper teammates retain the shape behind the ball.
  const arrival = midfield
    .filter((p) => p.id !== support?.id)
    .sort((a, b) => Math.abs(normalize(a).y - 34) - Math.abs(normalize(b).y - 34))[0];
  if (arrival && ball.x >= 65) assign(arrival, openLane(arrival, 83), 0.22);
  return runs;
}
