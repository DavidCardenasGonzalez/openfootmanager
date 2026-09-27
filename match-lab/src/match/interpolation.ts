import type { MatchFrame, RenderSample, ReplayData } from "./types";

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function interpolateFrames(a: MatchFrame, b: MatchFrame, timeMs: number): MatchFrame {
  const t = a === b ? 0 : Math.max(0, Math.min(1, (timeMs - a.timeMs) / (b.timeMs - a.timeMs)));
  const next = new Map(b.players.map((p) => [p.id, p]));
  return {
    ...a,
    timeMs,
    matchTimeSeconds: lerp(a.matchTimeSeconds, b.matchTimeSeconds, t),
    score: { ...a.score },
    players: a.players.map((p) => {
      const q = next.get(p.id) ?? p;
      const angle = Math.atan2(
        Math.sin(q.direction - p.direction),
        Math.cos(q.direction - p.direction),
      );
      return {
        ...p,
        x: lerp(p.x, q.x, t),
        y: lerp(p.y, q.y, t),
        direction: p.direction + angle * t,
      };
    }),
    ball: {
      ...a.ball,
      x: lerp(a.ball.x, b.ball.x, t),
      y: lerp(a.ball.y, b.ball.y, t),
      height: lerp(a.ball.height, b.ball.height, t),
    },
  };
}

export function sampleReplay(replay: ReplayData, timeMs: number): RenderSample {
  const time = Number.isFinite(timeMs) ? Math.max(0, Math.min(replay.durationMs, timeMs)) : 0;
  let low = 0;
  let high = replay.frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (replay.frames[mid].timeMs <= time) low = mid;
    else high = mid - 1;
  }
  const nextFrameIndex = Math.min(low + 1, replay.frames.length - 1);
  const a = replay.frames[low];
  const b = replay.frames[nextFrameIndex];
  return {
    frame: interpolateFrames(a, b, time),
    frameIndex: low,
    nextFrameIndex,
    alpha: a === b ? 0 : (time - a.timeMs) / (b.timeMs - a.timeMs),
    event: replay.events.findLast((e) => e.timeMs <= time),
  };
}
