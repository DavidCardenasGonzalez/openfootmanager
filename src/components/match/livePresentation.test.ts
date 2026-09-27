import { describe, expect, it } from "vitest";
import { buildLiveReplay, type PresentationSnapshot } from "./livePresentation";
import type { MatchEvent } from "./types";

function snapshot(): PresentationSnapshot {
  const team = (id: string) => ({
    id,
    formation: "4-4-2",
    players: Array.from({ length: 11 }, (_, i) => ({
      id: `${id}${i}`,
      position: i === 0 ? "Goalkeeper" : "Forward",
    })),
  });
  return {
    home_team: team("h"),
    away_team: team("a"),
    current_minute: 23,
    home_score: 1,
    away_score: 0,
    possession: "Home",
    ball_zone: "AwayBox",
    sent_off: [],
  };
}
const event = (event_type: string): MatchEvent => ({
  minute: 23,
  event_type,
  side: "Home",
  zone: "AwayBox",
  player_id: "h9",
  secondary_player_id: "h10",
});

describe("live match presentation adapter", () => {
  it("uses real IDs, authoritative scores and slot order, including substitutes and sendings off", () => {
    const data = snapshot();
    data.home_team.players[5].id = "substitute";
    data.sent_off = ["a4"];
    const replay = buildLiveReplay(data, [], new Map([["substitute", 25]]));
    const frame = replay.frames[0];
    expect(frame.players).toHaveLength(21);
    expect(frame.players[5]).toMatchObject({
      id: "substitute",
      shirtNumber: 25,
      goalkeeper: false,
    });
    expect(frame.players[1].x).toBeLessThan(frame.players[9].x);
    expect(frame.score).toEqual({ home: 1, away: 0 });
    expect(frame.matchTimeSeconds).toBe(23 * 60);
  });
  it("renders saves by the defending keeper without inventing a goal", () => {
    const replay = buildLiveReplay(snapshot(), [event("ShotSaved")], new Map());
    expect(replay.frames[replay.frames.length - 1].ball).toMatchObject({
      ownerId: "a0",
      motion: "possession",
    });
    expect(replay.events.map((e) => e.kind)).toContain("save");
    expect(replay.events.some((e) => e.kind === "goal")).toBe(false);
  });
  it("only celebrates real goals and sends misses outside the posts", () => {
    const goal = buildLiveReplay(snapshot(), [event("Goal")], new Map());
    expect(goal.events[goal.events.length - 1].kind).toBe("goal");
    expect(goal.frames[goal.frames.length - 1].ball.x).toBeGreaterThan(100);
    const miss = buildLiveReplay(snapshot(), [event("ShotOffTarget")], new Map());
    expect(miss.frames[miss.frames.length - 1].ball.y).toBeGreaterThan(40);
    expect(miss.events.some((e) => e.kind === "goal")).toBe(false);
  });
  it("keeps unknown events neutral and preserves input snapshots", () => {
    const data = snapshot();
    const before = JSON.stringify(data);
    const replay = buildLiveReplay(data, [event("Foul"), event("FutureEvent")], new Map());
    expect(replay.events.every((e) => e.kind === "reposition")).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
    expect(replay.frames.every((f, i) => i === 0 || f.timeMs > replay.frames[i - 1].timeMs)).toBe(
      true,
    );
  });
});

it("keeps supporting players moving through the middle of a passage, with plausible speed and facing", () => {
  const replay = buildLiveReplay(snapshot(), [event("PassCompleted")], new Map());
  const middle = replay.frames.filter((f) => f.timeMs >= 1600 && f.timeMs <= 2800);
  const moving = middle[0].players.filter(
    (p) =>
      !p.goalkeeper &&
      p.id !== "h9" &&
      p.id !== "h10" &&
      Math.hypot(
        p.x - (middle[middle.length - 1].players.find((q) => q.id === p.id)?.x ?? Number.NaN),
        p.y - (middle[middle.length - 1].players.find((q) => q.id === p.id)?.y ?? Number.NaN),
      ) > 0.3,
  );
  expect(moving.length).toBeGreaterThanOrEqual(10);
  for (let i = 1; i < replay.frames.length; i++) {
    const a = replay.frames[i - 1];
    const b = replay.frames[i];
    for (const p of b.players.filter((p) => !p.goalkeeper && p.id !== "h9")) {
      const old = a.players.find((q) => q.id === p.id);
      if (!old) throw new Error("Missing player");
      const speed = Math.hypot(p.x - old.x, p.y - old.y) / ((b.timeMs - a.timeMs) / 1000);
      expect(speed).toBeLessThanOrEqual(8.1);
      if (p.action === "run") {
        expect(speed).toBeGreaterThan(0.1);
        expect(
          Math.cos(p.direction) * (p.x - old.x) + Math.sin(p.direction) * (p.y - old.y),
        ).toBeGreaterThan(0);
      }
    }
  }
});
it("keeps possession attached to the carrier, receives a pass on the moving player, and is deterministic", () => {
  const replay = buildLiveReplay(snapshot(), [event("PassCompleted")], new Map());
  for (const frame of replay.frames.slice(1)) {
    if (!frame.ball.ownerId) continue;
    const owner = frame.players.find((p) => p.id === frame.ball.ownerId);
    if (!owner) throw new Error("Missing ball owner");
    expect(Math.hypot(frame.ball.x - owner.x, frame.ball.y - owner.y)).toBeLessThan(1.5);
  }
  expect(replay.frames[replay.frames.length - 1].ball.ownerId).toBe("h10");
  expect(buildLiveReplay(snapshot(), [event("PassCompleted")], new Map())).toEqual(replay);
  const next = buildLiveReplay(
    snapshot(),
    [event("Dribble")],
    new Map(),
    replay.frames[replay.frames.length - 1],
  );
  expect(next.frames[0].players.map((p) => [p.id, p.x, p.y])).toEqual(
    replay.frames[replay.frames.length - 1].players.map((p) => [p.id, p.x, p.y]),
  );
});

it("handles an away attack and eases supporting runs without changing the engine score", () => {
  const data = snapshot();
  const replay = buildLiveReplay(
    data,
    [
      {
        ...event("ShotSaved"),
        side: "Away",
        player_id: "a9",
        secondary_player_id: null,
        zone: "HomeBox",
      },
    ],
    new Map(),
  );
  expect(replay.frames[replay.frames.length - 1].ball.ownerId).toBe("h0");
  expect(
    replay.frames.every(
      (f) => f.score.home === data.home_score && f.score.away === data.away_score,
    ),
  ).toBe(true);
  const positions = replay.frames.map((f) => f.players.find((p) => p.id === "a5"));
  const travel = (i: number) =>
    Math.hypot(
      (positions[i]?.x ?? 0) - (positions[i - 1]?.x ?? 0),
      (positions[i]?.y ?? 0) - (positions[i - 1]?.y ?? 0),
    );
  expect(travel(20)).toBeGreaterThan(travel(2));
  expect(travel(20)).toBeGreaterThan(travel(39));
});
