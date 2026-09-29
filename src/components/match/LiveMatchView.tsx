import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MatchCanvas, type PlayerLabel } from "../../../match-lab/src/renderer/MatchCanvas";
import { PlaybackController } from "../../../match-lab/src/match/playbackController";
import { sampleReplay } from "../../../match-lab/src/match/interpolation";
import { buildLiveReplay, LIVE_CLIP_MS, LIVE_SPEED_MS } from "./livePresentation";
import { advanceLivePlayback } from "./livePlayback";
import { getCommentary } from "./commentary";
import { getPlayerName } from "./helpers";
import type { MatchSnapshot, SimSpeed, MatchEvent } from "./types";
import { calculateMatchRatings } from "./playerRatings";
import { useSettingsStore } from "../../store/settingsStore";
import { Checkbox } from "../ui";
import { MatchCinematic, isCinematicEvent } from "./MatchCinematic";

import { useGameStore } from "../../store/gameStore";
import { resolveMatchKits } from "../../../match-lab/src/renderer/kits";

interface Props {
  snapshot: MatchSnapshot;
  numbers: ReadonlyMap<string, number>;
  speed: SimSpeed;
  paused: boolean;
  onPlaybackComplete?: () => void;
  onGoalConfirmed?: (event: MatchEvent) => void;
  onPresentedScore?: (score: { home: number; away: number }) => void;
}

export function LiveMatchView({
  snapshot,
  numbers,
  speed,
  paused,
  onPlaybackComplete,
  onPresentedScore,
  onGoalConfirmed,
}: Props) {
  const { t } = useTranslation();
  const homeTeam = useGameStore((state) =>
    state.gameState?.teams.find((team) => team.id === snapshot.home_team.id),
  );
  const awayTeam = useGameStore((state) =>
    state.gameState?.teams.find((team) => team.id === snapshot.away_team.id),
  );
  const kits = useMemo(() => resolveMatchKits(homeTeam, awayTeam), [homeTeam, awayTeam]);
  const { settings, updateSettings } = useSettingsStore();
  const [sample, setSample] = useState(() =>
    sampleReplay(buildLiveReplay(snapshot, [], numbers), 0),
  );
  const callbacks = useRef({ onPlaybackComplete, onPresentedScore, onGoalConfirmed });
  callbacks.current = { onPlaybackComplete, onPresentedScore, onGoalConfirmed };
  const completed = useRef(false);
  const confirmedGoals = useRef(new Set<string>());
  const current = useRef(sample);
  const controller = useRef<PlaybackController | null>(null);
  const lastSnapshot = useRef(snapshot);
  const sourceEvents = useRef<readonly MatchEvent[]>([]);
  const rate = useRef(1);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  if (speed !== "paused") rate.current = LIVE_CLIP_MS / LIVE_SPEED_MS[speed];

  const announceGoals = useCallback(() => {
    const clock = controller.current;
    if (!clock) return;
    for (const marker of clock.replay.events) {
      if (
        marker.kind !== "goal" ||
        marker.timeMs > clock.timeMs ||
        confirmedGoals.current.has(marker.id)
      )
        continue;
      confirmedGoals.current.add(marker.id);
      const event = sourceEvents.current[Number(marker.id)];
      if (event) callbacks.current.onGoalConfirmed?.(event);
    }
  }, []);

  useEffect(() => {
    const previous = lastSnapshot.current;
    // A restored match starts at its snapshot, without replaying old history.
    const sameMatch =
      previous.home_team.id === snapshot.home_team.id &&
      previous.away_team.id === snapshot.away_team.id;
    const count =
      sameMatch && snapshot.events.length >= previous.events.length
        ? previous.events.length
        : snapshot.events.length;
    const fresh = snapshot.events.slice(count);
    const replay = buildLiveReplay(
      snapshot,
      fresh,
      numbers,
      sameMatch ? current.current.frame : undefined,
    );
    lastSnapshot.current = snapshot;
    sourceEvents.current = fresh;
    const clock = new PlaybackController(replay);
    if (pausedRef.current) clock.seek(replay.durationMs);
    else clock.play();
    controller.current = clock;
    completed.current = false;
    confirmedGoals.current.clear();
    current.current = sampleReplay(replay, clock.timeMs);
    setSample(current.current);
    callbacks.current.onPresentedScore?.(current.current.frame.score);
    announceGoals();
    if (!clock.playing) {
      completed.current = true;
      callbacks.current.onPlaybackComplete?.();
    }
  }, [snapshot, numbers, announceGoals]);

  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let previous = performance.now();
    let request = 0;
    const tick = (now: number) => {
      const clock = controller.current;
      if (clock?.playing && !paused) {
        if (motion?.matches) {
          // Retain goal announcements in reduced motion, without playing the shot.
          const goal = clock.replay.events.find(
            (e) => e.kind === "goal" && e.timeMs > clock.timeMs,
          );
          if (current.current.event?.kind === "goal")
            advanceLivePlayback(clock, now - previous, rate.current);
          else clock.seek(goal?.timeMs ?? clock.replay.durationMs);
        } else advanceLivePlayback(clock, now - previous, rate.current);
        current.current = sampleReplay(clock.replay, clock.timeMs);
        if (motion?.matches && current.current.event?.kind === "goal") {
          const next = clock.replay.events.find((e) => e.timeMs > clock.timeMs);
          const end = sampleReplay(clock.replay, (next?.timeMs ?? clock.replay.durationMs) - 0.001);
          // Show the completed huddle without animating the runs or the ball.
          current.current.frame = {
            ...current.current.frame,
            players: end.frame.players,
            ball: end.frame.ball,
          };
        }
        setSample(current.current);
        callbacks.current.onPresentedScore?.(current.current.frame.score);
        announceGoals();
        if (!clock.playing && !completed.current) {
          completed.current = true;
          callbacks.current.onPlaybackComplete?.();
        }
      }
      previous = now;
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [paused, announceGoals]);

  const freshCount = sourceEvents.current.length;
  const visibleEventCount =
    snapshot.events.length -
    freshCount +
    Math.min(
      freshCount,
      sourceEvents.current.filter((_, index) => {
        const replay = controller.current?.replay;
        if (!replay) return false;
        const goal = replay.events.find(
          (marker) => marker.id === `${index}` && marker.kind === "goal",
        );
        const next = replay.events.find((marker) => marker.id === `${index + 1}`);
        const confirmationTime = goal?.timeMs ?? next?.timeMs ?? replay.durationMs;
        return sample.frame.timeMs >= confirmationTime;
      }).length,
    );
  const playerLabels = useMemo(() => {
    const labels = new Map<string, PlayerLabel>();
    for (const side of ["Home", "Away"] as const) {
      const team = side === "Home" ? snapshot.home_team : snapshot.away_team;
      const ratings = calculateMatchRatings(snapshot, side, { eventCount: visibleEventCount });
      for (const player of team.players) {
        labels.set(player.id, {
          name: settings.show_match_player_names ? player.name : undefined,
          rating: settings.show_match_player_ratings ? ratings.get(player.id) : undefined,
        });
      }
    }
    return labels;
  }, [
    snapshot,
    visibleEventCount,
    settings.show_match_player_names,
    settings.show_match_player_ratings,
  ]);

  const sourceEvent = sample.event ? sourceEvents.current[Number(sample.event.id)] : undefined;
  const event =
    sourceEvent &&
    (!["Goal", "PenaltyGoal"].includes(sourceEvent.event_type) || sample.event?.kind === "goal")
      ? sourceEvent
      : undefined;
  // Goal sources first stage a shot. Announce only at its confirmed goal marker.
  const incident = event && isCinematicEvent(event) ? event : undefined;
  const commentary = event ? getCommentary(event, snapshot, t) : null;
  return (
    <section
      aria-label={t("match.matchView")}
      className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-900"
    >
      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 border-b border-gray-200 px-4 py-2 text-xs text-gray-700 dark:border-navy-700 dark:text-gray-200">
        <div className="flex items-center gap-2">
          <Checkbox
            id="match-player-names"
            checked={settings.show_match_player_names}
            onChange={(event) =>
              void updateSettings({ show_match_player_names: event.target.checked })
            }
          />
          <label htmlFor="match-player-names" className="cursor-pointer">
            {t("match.showPlayerNames")}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="match-player-ratings"
            checked={settings.show_match_player_ratings}
            onChange={(event) =>
              void updateSettings({ show_match_player_ratings: event.target.checked })
            }
          />
          <label htmlFor="match-player-ratings" className="cursor-pointer">
            {t("match.showPlayerRatings")}
          </label>
        </div>
      </div>
      <div className="relative">
        {incident && (
          <MatchCinematic
            event={incident}
            elapsedMs={sample.frame.timeMs - (sample.event?.timeMs ?? 0)}
            playerName={getPlayerName(snapshot, incident.player_id)}
            teamName={incident.side === "Home" ? snapshot.home_team.name : snapshot.away_team.name}
          />
        )}
        <MatchCanvas
          sample={sample}
          kits={kits}
          showNumbers
          showCoordinates={false}
          label={t("match.matchView")}
          goalLabel={t("match.eventTypes.Goal")}
          playerLabels={playerLabels}
          showGoalBanner={false}
        />
      </div>
      <div className="border-t border-gray-200 px-4 py-3 text-sm text-gray-700 dark:border-navy-700 dark:text-gray-200">
        <p className="font-heading font-bold">
          {event
            ? `${event.minute}' · ${commentary?.headline ?? t(`match.eventTypes.${event.event_type}`, { defaultValue: t("match.events") })}`
            : t("match.matchView")}
        </p>
        {event && <p>{commentary?.line ?? getPlayerName(snapshot, event.player_id)}</p>}
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("match.visualReconstruction")}
        </p>
      </div>
    </section>
  );
}
