import { interpolateFrames } from "../match/interpolation";
import type { BallState, MatchEvent, MatchFrame, PlayerState, ReplayData } from "../match/types";

type Point = readonly [number, number];
// Sparse authored snapshots, sampled by the existing interpolation function.
// This file supplies data only; playback and rendering are shared with every replay.
interface Beat {
  time: number;
  advance: number;
  positions: Record<string, Point>;
  ball: Point;
  owner?: string;
  motion?: BallState["motion"];
  height?: number;
  arc?: number;
  actor?: string;
  action?: "pass" | "shoot";
}
const start = {
  h6: [33, 39],
  h9: [62, 46],
  h10: [48, 20],
  a8: [42, 30],
  a10: [30, 38],
  a3: [75, 35],
  a4: [79, 24],
  a1: [96, 34],
} satisfies Record<string, Point>;
const interception = { ...start, h6: [36, 34], a8: [40, 31], a10: [32, 37] } satisfies Record<
  string,
  Point
>;
const breakaway = { ...interception, h6: [39, 34], h9: [62, 44], h10: [52, 20] } satisfies Record<
  string,
  Point
>;
const through = {
  ...breakaway,
  h6: [55, 32],
  h9: [72, 38],
  h10: [67, 19],
  a3: [76, 43],
  a4: [81, 23],
  a8: [49, 34],
} satisfies Record<string, Point>;
const receive = {
  ...through,
  h6: [61, 34],
  h9: [82, 31],
  h10: [76, 20],
  a3: [79, 39],
  a4: [84, 24],
} satisfies Record<string, Point>;
const shot = {
  ...receive,
  h9: [88, 31],
  h6: [66, 34],
  h10: [81, 23],
  a3: [84, 37],
  a4: [87, 24],
  a1: [95, 34],
} satisfies Record<string, Point>;
const saved = { ...shot, a1: [94, 30], a3: [86, 35], a4: [89, 25] } satisfies Record<string, Point>;
const settled = { ...saved, a1: [94, 32], h9: [86, 33], h10: [80, 25] } satisfies Record<
  string,
  Point
>;
const beats: Beat[] = [
  {
    time: 0,
    advance: 0,
    positions: start,
    ball: [41, 30],
    owner: "a8",
    actor: "a8",
    action: "pass",
  },
  {
    time: 500,
    advance: 0,
    positions: start,
    ball: [41, 30],
    motion: "pass",
    arc: 0.4,
    actor: "a8",
    action: "pass",
  },
  { time: 1500, advance: 0, positions: interception, ball: [37, 34], owner: "h6" },
  { time: 2400, advance: 0, positions: breakaway, ball: [40, 34], owner: "h6" },
  {
    time: 6500,
    advance: 8,
    positions: through,
    ball: [56, 32],
    owner: "h6",
    actor: "h6",
    action: "pass",
  },
  {
    time: 6800,
    advance: 8,
    positions: through,
    ball: [56, 32],
    motion: "pass",
    arc: 1.3,
    actor: "h6",
    action: "pass",
  },
  { time: 9300, advance: 12, positions: receive, ball: [83, 31], owner: "h9" },
  {
    time: 11000,
    advance: 15,
    positions: shot,
    ball: [89, 31],
    owner: "h9",
    actor: "h9",
    action: "shoot",
  },
  {
    time: 11400,
    advance: 15,
    positions: shot,
    ball: [89, 31],
    motion: "shot",
    arc: 0.7,
    actor: "h9",
    action: "shoot",
  },
  { time: 11600, advance: 15, positions: shot, ball: [90.5, 30.75], motion: "shot", height: 0.7 },
  { time: 12200, advance: 15, positions: saved, ball: [95, 30], owner: "a1", height: 0.7 },
  { time: 13000, advance: 15, positions: saved, ball: [95, 30], owner: "a1", height: 0.7 },
  { time: 14000, advance: 15, positions: settled, ball: [95, 32], owner: "a1" },
  { time: 16000, advance: 15, positions: settled, ball: [95, 32], owner: "a1" },
];
const shape: Point[] = [
  [5, 34],
  [20, 10],
  [19, 25],
  [19, 43],
  [20, 58],
  [35, 22],
  [38, 52],
  [42, 38],
  [48, 45],
  [43, 20],
  [50, 12],
];
function snapshot(beat: Beat): MatchFrame {
  const players: PlayerState[] = (["home", "away"] as const).flatMap((team) =>
    shape.map(([x, y], index) => {
      const id = `${team === "home" ? "h" : "a"}${index + 1}`;
      const point = beat.positions[id] ?? [
        team === "home" ? x + beat.advance : 100 - x + beat.advance * 0.3,
        team === "home" ? y : 68 - y,
      ];
      return {
        id,
        team,
        shirtNumber: index + 1,
        goalkeeper: index === 0,
        x: Math.min(98, point[0]),
        y: point[1],
        direction: team === "home" ? 0 : Math.PI,
        action: beat.actor === id ? (beat.action ?? "idle") : "idle",
      };
    }),
  );
  return {
    timeMs: beat.time,
    matchTimeSeconds: beat.time / 1000,
    players,
    score: { home: 0, away: 0 },
    ball: {
      x: beat.ball[0],
      y: beat.ball[1],
      height: beat.height ?? 0,
      motion: beat.motion ?? "possession",
      ownerId: beat.owner,
    },
  };
}
export function createCounterAttackReplay(): ReplayData {
  const snapshots = beats.map(snapshot);
  const frames: MatchFrame[] = [];
  for (let timeMs = 0; timeMs <= 16000; timeMs += 100) {
    const index = Math.min(
      beats.findLastIndex((b) => b.time <= timeMs),
      beats.length - 2,
    );
    const a = snapshots[index];
    const b = snapshots[index + 1];
    const beat = beats[index];
    const frame = interpolateFrames(a, b, timeMs);
    const t = (timeMs - a.timeMs) / (b.timeMs - a.timeMs);
    const players = frame.players.map((p, i): PlayerState => {
      const next = b.players[i];
      const previous = a.players[i];
      const moving = Math.hypot(next.x - previous.x, next.y - previous.y) > 0.05;
      const target =
        p.action === "shoot"
          ? [95, 30]
          : beat.actor === p.id && beat.time >= 6500
            ? [82, 31]
            : undefined;
      const direction = target
        ? Math.atan2(target[1] - p.y, target[0] - p.x)
        : moving
          ? Math.atan2(next.y - previous.y, next.x - previous.x)
          : p.direction;
      // Follow-through ends after contact instead of cycling through the whole pass.
      const action =
        (p.action === "pass" || p.action === "shoot") && (!beat.motion || timeMs - beat.time <= 200)
          ? p.action
          : moving
            ? "run"
            : "idle";
      return { ...p, direction, action };
    });
    frames.push({
      ...frame,
      players,
      ball: { ...frame.ball, height: frame.ball.height + Math.sin(Math.PI * t) * (beat.arc ?? 0) },
    });
  }
  const events: MatchEvent[] = [
    { id: "counter-pass", timeMs: 0, kind: "shortPass", team: "away", from: 8, to: 10 },
    { id: "counter-interception", timeMs: 1500, kind: "interception", team: "home", from: 6 },
    { id: "counter-break", timeMs: 2400, kind: "counterAttack", team: "home", from: 6 },
    { id: "counter-through", timeMs: 6500, kind: "throughBall", team: "home", from: 6, to: 9 },
    { id: "counter-receive", timeMs: 9300, kind: "dribble", team: "home", from: 9 },
    { id: "counter-shot", timeMs: 11000, kind: "shot", team: "home", from: 9 },
    { id: "counter-save", timeMs: 12200, kind: "save", team: "home", from: 9 },
  ];
  return { id: "counter-attack-save-v1", durationMs: 16000, frames, events };
}
export const counterAttackReplay = createCounterAttackReplay();
