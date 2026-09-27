import { lerp } from "../match/interpolation";
import type {
  BallState,
  EventKind,
  MatchEvent,
  MatchFrame,
  PlayerState,
  ReplayData,
} from "../match/types";

type Point = readonly [number, number];
interface Cue {
  time: number;
  shift: number;
  positions?: Record<string, Point>;
  ball: Point;
  owner?: string;
  motion?: BallState["motion"];
  arc?: number;
  actor?: string;
  action?: "pass" | "shoot";
}
const formation: Point[] = [
  [5, 34],
  [22, 9],
  [19, 25],
  [19, 43],
  [22, 59],
  [35, 18],
  [35, 52],
  [42, 42],
  [46, 25],
  [49, 34],
  [41, 10],
];
const attack = { h7: [67, 14], h8: [45, 42], h10: [62, 31], h9: [75, 37] } satisfies Record<
  string,
  Point
>;
const pressure = {
  ...attack,
  h7: [75, 18],
  h10: [79, 29],
  h9: [83, 39],
  a4: [81, 29],
  a3: [78, 33],
} satisfies Record<string, Point>;
// Authored movement inside this one combination, not simulation/AI. Smooth easing
// gives the runs a launch and a braking phase; the striker bends behind the marker.
const progress = (time: number, start: number, end: number) => {
  const t = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return t * t * (3 - 2 * t);
};
function combinationPositions(time: number): Record<string, Point> {
  const run = (a: Point, b: Point, start: number, end: number): Point => {
    const t = progress(time, start, end);
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  };
  const striker = progress(time, 20000, 23300);
  const reception =
    time < 21500 ? run([79, 29], [81, 26], 20000, 21100) : run([81, 26], [82, 29], 21500, 22100);
  return {
    h7: run([75, 18], [86, 19], 20500, 24500),
    h10: time < 22400 ? reception : run([82, 29], [86, 27], 22400, 25000),
    h9: [83 + 5 * striker, 39 - 2 * striker + 5 * Math.sin(Math.PI * striker)],
    h8: run([45, 42], [62, 44], 20000, 25000),
    h11: run([59, 10], [74, 12], 20000, 25000),
    a3: run([78, 33], [85, 38], 20400, 24900),
    a4: run([81, 29], [84, 32], 20800, 24800),
    a1:
      time < 23800
        ? run([95, 34], [96, 34], 20000, 23800)
        : run([96, 34], [98, 31.8], 24600, 25000),
  };
}
const finish = { ...pressure, ...combinationPositions(25000) };
const cues: Cue[] = [
  { time: 0, shift: 0, ball: [50, 34], owner: "h10" },
  { time: 2500, shift: 0, ball: [50, 34], owner: "h10" },
  {
    time: 5000,
    shift: 3,
    positions: { h10: [51, 34], h8: [45, 42] },
    ball: [52, 34],
    motion: "pass",
    arc: 0.5,
  },
  { time: 6500, shift: 4, positions: { h10: [54, 33], h8: [45, 42] }, ball: [46, 42], owner: "h8" },
  {
    time: 9000,
    shift: 6,
    positions: { h8: [48, 40], h7: [63, 16] },
    ball: [49, 40],
    motion: "pass",
    arc: 5,
  },
  { time: 11500, shift: 10, positions: attack, ball: [68, 14], owner: "h7" },
  {
    time: 17000,
    shift: 15,
    positions: { ...pressure, h7: [74, 23], h10: [76, 30] },
    ball: [75, 23],
    owner: "h7",
  },
  {
    time: 19000,
    shift: 17,
    positions: { ...pressure, h7: [76, 25], a4: [78, 26] },
    ball: [77, 25],
    owner: "h7",
  },
  { time: 20000, shift: 18, ball: [76, 18], owner: "h7", actor: "h7", action: "pass" },
  {
    time: 20300,
    shift: 18.3,
    ball: [76, 18],
    motion: "pass",
    arc: 0.45,
    actor: "h7",
    action: "pass",
  },
  { time: 20600, shift: 18.6, ball: [78.25, 21], motion: "pass", arc: 0.3 },
  { time: 21100, shift: 19.1, ball: [82, 26], owner: "h10" },
  { time: 21500, shift: 19.5, ball: [82, 26], owner: "h10" },
  { time: 22100, shift: 20.1, ball: [83, 29], owner: "h10", actor: "h10", action: "pass" },
  {
    time: 22400,
    shift: 20.4,
    ball: [83, 29],
    motion: "pass",
    arc: 0.25,
    actor: "h10",
    action: "pass",
  },
  { time: 22700, shift: 20.7, ball: [85, 31.67], motion: "pass", arc: 0.2 },
  { time: 23300, shift: 21.3, ball: [89, 37], owner: "h9" },
  { time: 23800, shift: 21.8, ball: [89, 37], owner: "h9" },
  { time: 24000, shift: 22, ball: [89, 37], owner: "h9", actor: "h9", action: "shoot" },
  {
    time: 24400,
    shift: 22,
    ball: [89, 37],
    motion: "shot",
    arc: 0.8,
    actor: "h9",
    action: "shoot",
  },
  { time: 25000, shift: 22, positions: finish, ball: [101.5, 31.4], motion: "goal" },
  { time: 25200, shift: 22, positions: finish, ball: [102.4, 31.1], motion: "goal", arc: 0.2 },
  { time: 25500, shift: 22, positions: finish, ball: [101.8, 31.6], motion: "goal" },
  {
    time: 29000,
    shift: 23,
    positions: { ...finish, h7: [86, 34], h10: [89, 32], h9: [91, 35], a1: [98, 37] },
    ball: [101.8, 31.6],
    motion: "reset",
  },
  {
    time: 37000,
    shift: 0,
    positions: { a10: [51, 34], h10: [40, 34] },
    ball: [50, 34],
    owner: "a10",
  },
  {
    time: 40000,
    shift: 0,
    positions: { a10: [51, 34], h10: [40, 34] },
    ball: [50, 34],
    owner: "a10",
  },
];
function playersAt(cue: Cue): PlayerState[] {
  return (["home", "away"] as const).flatMap((team) =>
    formation.map(([x, y], i) => {
      const id = `${team === "home" ? "h" : "a"}${i + 1}`;
      const point =
        (cue.time >= 20000 && cue.time <= 25000 ? combinationPositions(cue.time)[id] : undefined) ??
        cue.positions?.[id];
      return {
        id,
        team,
        shirtNumber: i + 1,
        goalkeeper: i === 0,
        x:
          point?.[0] ??
          (team === "home"
            ? Math.min(92, x + cue.shift * (i === 0 ? 0.15 : 1))
            : Math.min(96, (i === 9 ? 60 : 100 - x) + cue.shift * (i === 0 ? 0 : 0.45))),
        y: point?.[1] ?? (team === "home" ? y : 68 - y),
        direction: team === "home" ? 0 : Math.PI,
        action: "idle",
      };
    }),
  );
}
export function createDemoReplay(): ReplayData {
  const event = (timeMs: number, kind: EventKind, from?: number, to?: number): MatchEvent => ({
    id: `event-${timeMs}`,
    timeMs,
    kind,
    team: timeMs >= 37000 ? "away" : "home",
    from,
    to,
  });
  const events = [
    event(0, "kickoff", 10),
    event(2500, "reposition"),
    event(5000, "shortPass", 10, 8),
    event(9000, "longPass", 8, 7),
    event(11500, "dribble", 7),
    event(17000, "pressure", 4, 7),
    event(20000, "attack", 7, 10),
    event(22100, "attack", 10, 9),
    event(24000, "shot", 9),
    event(25000, "goal", 9),
    event(29000, "reset"),
    event(37000, "kickoff", 10),
  ];
  const formations = cues.map(playersAt);
  const frames: MatchFrame[] = [];
  for (let timeMs = 0; timeMs <= 40000; timeMs += 100) {
    const index = Math.min(
      cues.findLastIndex((c) => c.time <= timeMs),
      cues.length - 2,
    );
    const a = cues[index];
    const b = cues[index + 1];
    const t = (timeMs - a.time) / (b.time - a.time);
    const players = formations[index].map((p, i): PlayerState => {
      const q = formations[index + 1][i];
      const moving = Math.hypot(q.x - p.x, q.y - p.y) > 0.1;
      const acting =
        a.actor === p.id
          ? a.action
          : a.time < 20000 && a.motion === "shot" && p.id === "h9"
            ? "shoot"
            : a.time < 20000 &&
                a.motion === "pass" &&
                p.id ===
                  (a.time === 5000
                    ? "h10"
                    : a.time === 9000
                      ? "h8"
                      : a.time === 20000
                        ? "h7"
                        : "h10")
              ? "pass"
              : undefined;
      const position =
        timeMs >= 20000 && timeMs <= 25000 ? combinationPositions(timeMs)[p.id] : undefined;
      const ahead = position ? combinationPositions(timeMs + 20)[p.id] : undefined;
      const dx = position && ahead ? ahead[0] - position[0] : q.x - p.x;
      const dy = position && ahead ? ahead[1] - position[1] : q.y - p.y;
      const running = position ? Math.hypot(dx, dy) > 0.002 : moving;
      let direction = running ? Math.atan2(dy, dx) : p.direction;
      if (position) {
        let target: Point | undefined;
        if (p.id === "h7" && timeMs < 20600) target = [81, 26];
        if (p.id === "h10" && timeMs >= 21000 && timeMs < 22400) {
          const turn = progress(timeMs, 21400, 22100);
          const incoming = Math.atan2(18 - position[1], 75 - position[0]);
          const outgoing = Math.atan2(37 - position[1], 88 - position[0]);
          direction =
            incoming +
            Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)) * turn;
        }
        if (p.id === "h9" && timeMs >= 23300) {
          const incoming = Math.atan2(29 - position[1], 82 - position[0]);
          const outgoing = Math.atan2(31.4 - position[1], 101.5 - position[0]);
          direction =
            incoming +
            Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)) *
              progress(timeMs, 23600, 24000);
        }
        if (p.id === "a1" && timeMs < 24600) target = [88, 37];
        if (target) direction = Math.atan2(target[1] - position[1], target[0] - position[0]);
      }
      return {
        ...p,
        x: position?.[0] ?? lerp(p.x, q.x, t),
        y: position?.[1] ?? lerp(p.y, q.y, t),
        direction,
        action: acting ?? (running ? "run" : "idle"),
      };
    });
    let ballX = lerp(a.ball[0], b.ball[0], t);
    let ballY = lerp(a.ball[1], b.ball[1], t);
    let height = Math.sin(t * Math.PI) * (a.arc ?? 0);
    if (timeMs >= 20000 && timeMs < 25000) {
      const owner = players.find((p) => p.id === a.owner);
      if (owner) {
        ballX = owner.x + 1;
        ballY = owner.y;
        height = 0;
      }
      const flight =
        timeMs >= 24400
          ? { start: 24400, end: 25000, from: [89, 37], to: [101.5, 31.4], arc: 0.8 }
          : timeMs >= 22400 && timeMs < 23300
            ? { start: 22400, end: 23300, from: [83, 29], to: [89, 37], arc: 0.25 }
            : timeMs >= 20300 && timeMs < 21100
              ? { start: 20300, end: 21100, from: [76, 18], to: [82, 26], arc: 0.45 }
              : undefined;
      if (flight) {
        const f = (timeMs - flight.start) / (flight.end - flight.start);
        ballX = lerp(flight.from[0], flight.to[0], f);
        ballY = lerp(flight.from[1], flight.to[1], f);
        height = 4 * f * (1 - f) * flight.arc;
      }
    }
    frames.push({
      timeMs,
      matchTimeSeconds: timeMs / 1000,
      players,
      score: { home: timeMs >= 25000 ? 1 : 0, away: 0 },
      ball: {
        x: ballX,
        y: ballY,
        height,
        ownerId: a.owner,
        motion: a.motion ?? "possession",
      },
    });
  }
  return { id: "match-lab-demo-v1", durationMs: 40000, frames, events };
}
export const demoReplay = createDemoReplay();
