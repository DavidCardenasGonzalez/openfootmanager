import type { EnginePlayerData, MatchSnapshot } from "./types";

type RatingPlayer = Pick<EnginePlayerData, "id">;
type RatingSnapshot = Pick<MatchSnapshot, "phase" | "home_score" | "away_score" | "events"> & {
  home_team: { players: readonly RatingPlayer[] };
  away_team: { players: readonly RatingPlayer[] };
  home_bench: readonly RatingPlayer[];
  away_bench: readonly RatingPlayer[];
};

const EVENT_RATING_CHANGE: Readonly<Record<string, number>> = {
  Goal: 1.2,
  PenaltyGoal: 1.2,
  ShotSaved: 0.2,
  ShotOnTarget: 0.2,
  ShotOffTarget: -0.1,
  PassCompleted: 0.02,
  Tackle: 0.15,
  Interception: 0.15,
  Foul: -0.2,
  YellowCard: -0.5,
  SecondYellow: -0.5,
  RedCard: -1.5,
};

/** One formula for the live pitch and final panel. The event limit follows visual playback. */
export function calculateMatchRatings(
  snapshot: RatingSnapshot,
  side: "Home" | "Away",
  {
    eventCount = snapshot.events.length,
    includeResultBonus = snapshot.phase === "Finished" || snapshot.phase === "FullTime",
  }: { eventCount?: number; includeResultBonus?: boolean } = {},
): ReadonlyMap<string, number> {
  const team = side === "Home" ? snapshot.home_team : snapshot.away_team;
  const bench = side === "Home" ? snapshot.home_bench : snapshot.away_bench;
  // Outgoing substitutes remain on the bench and can have assisted players still on the pitch.
  const ratings = new Map([...team.players, ...bench].map((player) => [player.id, 6]));
  for (const event of snapshot.events.slice(0, eventCount)) {
    if (event.side !== side) continue;
    const current = event.player_id ? ratings.get(event.player_id) : undefined;
    if (event.player_id && current !== undefined) {
      ratings.set(event.player_id, current + (EVENT_RATING_CHANGE[event.event_type] ?? 0));
    }
    if (event.event_type === "Goal" || event.event_type === "PenaltyGoal") {
      const assist = event.secondary_player_id ? ratings.get(event.secondary_player_id) : undefined;
      if (event.secondary_player_id && assist !== undefined) {
        ratings.set(event.secondary_player_id, assist + 0.7);
      }
    }
  }
  const won =
    side === "Home"
      ? snapshot.home_score > snapshot.away_score
      : snapshot.away_score > snapshot.home_score;
  const bonus = includeResultBonus && eventCount >= snapshot.events.length && won ? 0.5 : 0;
  for (const [id, rating] of ratings) {
    ratings.set(id, Math.round(Math.max(1, Math.min(10, rating + bonus)) * 10) / 10);
  }
  return ratings;
}
