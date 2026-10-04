import type {
  MatchFrame,
  PlayerState,
  ReplayData,
  EventKind,
} from "../../../match-lab/src/match/types";
import { easeMovement, supportingPaths } from "./presentationMovement";
import { createDefensiveMovement } from "./defensiveMovement";
import { buildGoalCelebration } from "./goalCelebration";
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
export const LIVE_GOAL_CELEBRATION_MS = 14000;
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
  for (const event of sourceEvents) {
    if (["Goal", "PenaltyGoal"].includes(event.event_type))
      score[event.side === "Home" ? "home" : "away"]--;
  }
  const initial: MatchFrame = {
    timeMs: 0,
    matchTimeSeconds: snapshot.current_minute * 60,
    score: { ...score },
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
  const moveDefense = createDefensiveMovement(players);
  const events: ReplayData["events"][number][] = [];
  const source = sourceEvents.length ? sourceEvents : [null];
  const segment = LIVE_CLIP_MS / source.length;
  let celebrationTime = 0;
  source.forEach((event, index) => {
    const start = index * segment + celebrationTime;
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
    if (shot || pass) events.push({ ...visualEvent, timeMs: start + segment * 0.4 });
    if (kind === "goal" || kind === "save")
      events.push({ ...visualEvent, timeMs: start + segment * 0.8, kind });
    const origin = frames[frames.length - 1].players;
    const paths = supportingPaths(
      players,
      origin,
      { x, y },
      team,
      actor?.id,
      pass ? receiver?.id : undefined,
      segment,
      Boolean(actor && kind !== "reposition" && kind !== "kickoff"),
    );
    const actorOrigin = origin.find((p) => p.id === actor?.id);
    const receiverLanding = receiver ? paths.get(receiver.id)?.(0.8) : undefined;
    const active = actor && kind !== "reposition" && kind !== "kickoff";
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
      : (receiverLanding?.x ?? x + sign * 7);
    const targetY =
      event?.event_type === "ShotOffTarget" || event?.event_type === "PenaltyMiss"
        ? 45
        : shot
          ? 34
          : (receiverLanding?.y ?? y);
    const blocked = event?.event_type === "ShotBlocked";
    // Dense samples preserve eased movement under the existing linear interpolator.
    const samples = Math.max(20, Math.ceil(segment / 100 / 20) * 20);
    for (let step = 1; step <= samples; step++) {
      const fraction = step / samples;
      const isRelease = fraction >= 0.4;
      const flight = Math.max(0, Math.min(1, (fraction - 0.4) / 0.4));
      const save = kind === "save" && flight === 1 && keeper;
      const last = frames[frames.length - 1];
      const staged = players.map((p) => {
        let position = paths.get(p.id)?.(fraction) ?? p;
        if (active && p.id === actor.id && actorOrigin) {
          const t = easeMovement(fraction / (shot || pass ? 0.32 : 1));
          position = {
            x: actorOrigin.x + (x - actorOrigin.x) * t,
            y: actorOrigin.y + (y - actorOrigin.y) * t,
          };
        }
        if (shot && p.id === keeper?.id) {
          const from = origin.find((q) => q.id === p.id) ?? p;
          const t = easeMovement(fraction / 0.8);
          position = {
            x: from.x + ((team === "home" ? 97 : 3) - from.x) * t,
            y: from.y + (34 - from.y) * t,
          };
        }
        const old = last.players.find((q) => q.id === p.id) ?? p;
        const dx = position.x - old.x;
        const dy = position.y - old.y;
        const moving = Math.hypot(dx, dy) / (segment / samples / 1000) > 0.15;
        const kicking =
          active && p.id === actor.id && (shot || pass) && fraction >= 0.3 && fraction <= 0.48;
        const receiving = pass && p.id === receiver?.id && fraction >= 0.8;
        return {
          ...p,
          ...position,
          direction:
            kicking || (active && p.id === actor.id && !moving)
              ? Math.atan2(targetY - position.y, targetX - position.x)
              : moving
                ? Math.atan2(dy, dx)
                : Math.atan2(y - position.y, x - position.x),
          action: kicking
            ? shot
              ? ("shoot" as const)
              : ("pass" as const)
            : receiving
              ? ("idle" as const)
              : moving
                ? ("run" as const)
                : ("idle" as const),
        };
      });
      const carrier = staged.find((p) => p.id === actor?.id);
      const recipient = staged.find((p) => p.id === receiver?.id);
      const ball: MatchFrame["ball"] = !active
        ? { x, y: kind === "kickoff" ? 34 : y, height: 0, motion: "reset" }
        : ((!shot && !pass) || !isRelease) && carrier
          ? { x: carrier.x, y: carrier.y, height: 0, ownerId: actor.id, motion: "possession" }
          : pass && flight === 1 && recipient
            ? {
                x: recipient.x,
                y: recipient.y,
                height: 0,
                ownerId: recipient.id,
                motion: "possession",
              }
            : save
              ? {
                  x: team === "home" ? 97 : 3,
                  y: 34,
                  height: 0,
                  ownerId: keeper.id,
                  motion: "possession",
                }
              : {
                  x:
                    kind === "goal"
                      ? x +
                        ((team === "home" ? 100 : 0) - x) * flight +
                        sign * 2 * Math.max(0, (fraction - 0.8) / 0.2)
                      : x + (targetX - x) * (blocked ? flight * 0.3 : flight),
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
      // Follow the actual carrier/pass. For shots the defensive threat remains
      // at the shooter; chasing the ball into the net would break the block.
      const defensiveFocus = shot ? (carrier ?? { x, y }) : ball;
      const defense = moveDefense(last.players, defensiveFocus, team, segment / samples);
      const coordinated = staged.map((p) => {
        const position = defense.get(p.id);
        if (!position) return p;
        const old = last.players.find((q) => q.id === p.id) ?? p;
        const dx = position.x - old.x;
        const dy = position.y - old.y;
        const moving = Math.hypot(dx, dy) / (segment / samples / 1000) > 0.15;
        return {
          ...p,
          ...position,
          direction: moving
            ? Math.atan2(dy, dx)
            : Math.atan2(defensiveFocus.y - position.y, defensiveFocus.x - position.x),
          action: moving ? ("run" as const) : ("idle" as const),
        };
      });
      if (kind === "goal" && step === samples * 0.8) score[team]++;
      frames.push({
        timeMs: start + segment * fraction,
        matchTimeSeconds: snapshot.current_minute * 60,
        score: { ...score },
        players: coordinated,
        ball,
      });
    }
    if (kind === "goal") {
      const end = frames[frames.length - 1];
      const celebration = buildGoalCelebration(end, team, actor?.id, LIVE_GOAL_CELEBRATION_MS);
      frames.push(...celebration);
      celebrationTime += celebration[celebration.length - 1].timeMs - end.timeMs;
    }
  });
  return {
    id: `${snapshot.current_minute}:${sourceEvents.length}`,
    durationMs: LIVE_CLIP_MS + celebrationTime,
    frames,
    events,
  };
}
