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
