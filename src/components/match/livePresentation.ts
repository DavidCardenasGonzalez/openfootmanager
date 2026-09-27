import type {
  MatchFrame,
  PlayerState,
  ReplayData,
  EventKind,
} from "../../../match-lab/src/match/types";
import { buildPitchRows } from "../squad/SquadTab.helpers";
import type { MatchSnapshot, MatchEvent, SimSpeed, EngineTeamData } from "./types";

/** Presentation pacing only. Rust still owns simulation time and every outcome. */
export const LIVE_SPEED_MS: Record<SimSpeed, number> = {
  paused: 0,
  slow: 8000,
  normal: 4000,
  fast: 1000,
  instant: 100,
};
export const LIVE_CLIP_MS = 4000;
type TeamInput = Pick<EngineTeamData, "id" | "formation"> & {
  players: Pick<EngineTeamData["players"][number], "id" | "position">[];
};
export type PresentationSnapshot = Pick<
  MatchSnapshot,
  "current_minute" | "home_score" | "away_score" | "possession" | "ball_zone" | "sent_off"
> & { home_team: TeamInput; away_team: TeamInput };
const zoneX: Record<string, number> = {
  HomeBox: 9,
  HomeDefense: 25,
  Midfield: 50,
  AwayDefense: 75,
  AwayBox: 91,
};
const kinds: Record<string, EventKind> = {
  KickOff: "kickoff",
  SecondHalfStart: "kickoff",
  PassCompleted: "shortPass",
  Cross: "longPass",
  PassIntercepted: "pressure",
  Interception: "interception",
  Tackle: "interception",
  Dribble: "dribble",
  DribbleTackled: "pressure",
  ShotOnTarget: "shot",
  ShotOffTarget: "shot",
  ShotBlocked: "shot",
  ShotSaved: "save",
  Goal: "goal",
  PenaltyGoal: "goal",
  PenaltyMiss: "shot",
};

/** Spatial staging is illustrative: engine snapshots contain zones, not tracking coordinates.
 * This adapter never calculates results, alters lineups, or writes back to the engine. */
export function buildLiveReplay(
  snapshot: PresentationSnapshot,
  sourceEvents: readonly MatchEvent[],
  numbers: ReadonlyMap<string, number>,
  previous?: MatchFrame,
): ReplayData {
  const players: PlayerState[] = [];
  for (const team of ["home", "away"] as const) {
    const data = snapshot[`${team}_team`];
    const rows = buildPitchRows(data.formation);
    const slots = rows.flatMap((row, rowIndex) =>
      row.positions.map((_, column) => ({
        x: rowIndex === 0 ? 5 : 18 + (rowIndex - 1) * (52 / Math.max(1, rows.length - 2)),
        y: (68 * (column + 1)) / (row.positions.length + 1),
      })),
    );
    data.players.forEach((p, index) => {
      if (snapshot.sent_off.includes(p.id)) return;
      const slot = slots[index] ?? { x: 50, y: 34 };
      players.push({
        id: p.id,
        team,
        shirtNumber: numbers.get(p.id) ?? index + 1,
        goalkeeper: index === 0,
        x: team === "home" ? slot.x : 100 - slot.x,
        y: team === "home" ? slot.y : 68 - slot.y,
        direction: team === "home" ? 0 : Math.PI,
        action: "idle",
      });
    });
  }
  const score = { home: snapshot.home_score, away: snapshot.away_score };
  const initial: MatchFrame = {
    timeMs: 0,
    matchTimeSeconds: snapshot.current_minute * 60,
    score,
    players: players.map((p) => {
      const old = previous?.players.find((o) => o.id === p.id);
      return old ? { ...p, x: old.x, y: old.y, direction: old.direction, action: "idle" } : p;
    }),
    ball: previous
      ? {
          ...previous.ball,
          ownerId: players.some((p) => p.id === previous.ball.ownerId)
            ? previous.ball.ownerId
            : undefined,
        }
      : { x: zoneX[snapshot.ball_zone] ?? 50, y: 34, height: 0, motion: "reset" },
  };
  const frames: MatchFrame[] = [initial];
  const events: ReplayData["events"][number][] = [];
  const source = sourceEvents.length ? sourceEvents : [null];
  const segment = LIVE_CLIP_MS / source.length;
  source.forEach((event, index) => {
    const start = index * segment;
    const team = (event?.side ?? snapshot.possession) === "Home" ? "home" : "away";
    const sign = team === "home" ? 1 : -1;
    const kind = event ? (kinds[event.event_type] ?? "reposition") : "reposition";
    const actor = players.find((p) => p.id === event?.player_id);
    const receiver =
      players.find((p) => p.id === event?.secondary_player_id) ??
      players.find(
        (p) =>
          p.team === team &&
          !p.goalkeeper &&
          p.id !== actor?.id &&
          Math.abs(p.x - (actor?.x ?? 50)) < 25,
      );
    const keeper = players.find((p) => p.team !== team && p.goalkeeper);
    const shot = ["shot", "save", "goal"].includes(kind);
    const pass = kind === "shortPass" || kind === "longPass";
    const x = shot
      ? team === "home"
        ? 82
        : 18
      : kind === "kickoff"
        ? 50
        : (zoneX[event?.zone ?? snapshot.ball_zone] ?? 50);
    const y = shot ? 30 : (actor?.y ?? 34);
    const id = `${index}`;
    const visualEvent: ReplayData["events"][number] = {
      id,
      timeMs: start,
      kind: shot ? ("shot" as const) : kind,
      team,
      from: actor?.shirtNumber,
      to: receiver?.shirtNumber,
    };
    events.push(visualEvent);
    if (kind === "goal" || kind === "save")
      events.push({ ...visualEvent, timeMs: start + segment * 0.8, kind });
    for (const fraction of [0.2, 0.4, 0.65, 0.8, 1]) {
      const isRelease = fraction >= 0.4;
      const flight = Math.max(0, Math.min(1, (fraction - 0.4) / 0.4));
      const crossesLine =
        kind === "goal" ||
        event?.event_type === "ShotOffTarget" ||
        event?.event_type === "PenaltyMiss";
      const targetX = shot
        ? team === "home"
          ? crossesLine
            ? 102
            : 97
          : crossesLine
            ? -2
            : 3
        : receiver
          ? Math.max(4, Math.min(96, receiver.x + (x - 50) * 0.18))
          : x + sign * 7;
      const targetY =
        event?.event_type === "ShotOffTarget" || event?.event_type === "PenaltyMiss"
          ? 45
          : shot
            ? 34
            : (receiver?.y ?? y);
      const save = kind === "save" && flight === 1 && keeper;
      const blocked = event?.event_type === "ShotBlocked";
      const active = actor && kind !== "reposition" && kind !== "kickoff";
      const staged = players.map((p) => {
        if (active && p.id === actor.id)
          return {
            ...p,
            x,
            y,
            direction: Math.atan2(targetY - y, targetX - x),
            action: shot ? ("shoot" as const) : pass ? ("pass" as const) : ("run" as const),
          };
        if (shot && keeper?.id === p.id)
          return { ...p, x: team === "home" ? 97 : 3, y: 34, action: "idle" as const };
        return {
          ...p,
          x: p.goalkeeper ? p.x : Math.max(4, Math.min(96, p.x + (x - 50) * 0.18)),
          action: fraction < 0.8 ? ("run" as const) : ("idle" as const),
        };
      });
      const ball: MatchFrame["ball"] = !active
        ? { x, y: kind === "kickoff" ? 34 : y, height: 0, motion: "reset" }
        : !shot && !pass
          ? { x, y, height: 0, ownerId: actor.id, motion: "possession" }
          : save
            ? {
                x: team === "home" ? 97 : 3,
                y: 34,
                height: 0,
                ownerId: keeper.id,
                motion: "possession",
              }
            : {
                x: x + (targetX - x) * (blocked ? flight * 0.3 : flight),
                y: y + (targetY - y) * flight,
                height: isRelease
                  ? Math.sin(flight * Math.PI) * (shot ? 1.7 : kind === "longPass" ? 3 : 0.3)
                  : 0,
                ownerId: !isRelease ? actor.id : !shot && flight === 1 ? receiver?.id : undefined,
                motion:
                  !isRelease || (!shot && flight === 1 && !!receiver)
                    ? "possession"
                    : kind === "goal" && flight === 1
                      ? "goal"
                      : shot
                        ? "shot"
                        : "pass",
              };
      frames.push({
        timeMs: start + segment * fraction,
        matchTimeSeconds: snapshot.current_minute * 60,
        score,
        players: staged,
        ball,
      });
    }
  });
  return {
    id: `${snapshot.current_minute}:${sourceEvents.length}`,
    durationMs: LIVE_CLIP_MS,
    frames,
    events,
  };
}
