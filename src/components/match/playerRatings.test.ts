import { describe, expect, it } from "vitest";
import { calculateMatchRatings } from "./playerRatings";
import type { MatchEvent } from "./types";

const event = (overrides: Partial<MatchEvent> = {}): MatchEvent => ({
  minute: 10,
  event_type: "Goal",
  side: "Home",
  zone: "AwayBox",
  player_id: "scorer",
  secondary_player_id: "assist",
  ...overrides,
});

const snapshot = (events: MatchEvent[] = [], phase = "FirstHalf") => ({
  phase,
  home_score: 1,
  away_score: 0,
  home_team: { players: [{ id: "scorer" }, { id: "assist" }] },
  away_team: { players: [{ id: "opponent" }] },
  home_bench: [{ id: "subbed-off" }],
  away_bench: [],
  events,
});

describe("calculateMatchRatings", () => {
  it("starts at 6.0 and applies goals and assists without a live result bonus", () => {
    expect(calculateMatchRatings(snapshot(), "Home").get("scorer")).toBe(6);
    const ratings = calculateMatchRatings(snapshot([event()]), "Home");
    expect(ratings.get("scorer")).toBe(7.2);
    expect(ratings.get("assist")).toBe(6.7);
    expect(calculateMatchRatings(snapshot([event()]), "Away").get("opponent")).toBe(6);
  });

  it("rates assists by substituted players and updates the incoming player", () => {
    const ratings = calculateMatchRatings(
      snapshot([event({ player_id: "subbed-off", secondary_player_id: "scorer" })]),
      "Home",
    );
    expect(ratings.get("scorer")).toBe(6.7);
    expect(ratings.get("subbed-off")).toBe(7.2);
  });

  it("only includes completed visual events when given an event limit", () => {
    const match = snapshot([event(), event({ event_type: "YellowCard" })]);
    expect(calculateMatchRatings(match, "Home", { eventCount: 0 }).get("scorer")).toBe(6);
    expect(calculateMatchRatings(match, "Home", { eventCount: 1 }).get("scorer")).toBe(7.2);
    expect(calculateMatchRatings(match, "Home").get("scorer")).toBe(6.7);
  });

  it("adds the winning bonus only at full time and keeps ratings within 1–10", () => {
    expect(calculateMatchRatings(snapshot([event()], "Finished"), "Home").get("scorer")).toBe(7.7);
    expect(calculateMatchRatings(snapshot([event()], "FullTime"), "Home").get("scorer")).toBe(7.7);
    expect(
      calculateMatchRatings(snapshot(Array.from({ length: 10 }, () => event())), "Home").get(
        "scorer",
      ),
    ).toBe(10);
    expect(
      calculateMatchRatings(
        snapshot(Array.from({ length: 10 }, () => event({ event_type: "RedCard" }))),
        "Home",
      ).get("scorer"),
    ).toBe(1);
  });
});
