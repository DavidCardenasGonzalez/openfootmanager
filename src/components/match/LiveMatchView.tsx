import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MatchCanvas, type PlayerLabel } from "../../../match-lab/src/renderer/MatchCanvas";
import { PlaybackController } from "../../../match-lab/src/match/playbackController";
import { sampleReplay } from "../../../match-lab/src/match/interpolation";
import { buildLiveReplay, LIVE_CLIP_MS, LIVE_SPEED_MS } from "./livePresentation";
import { getCommentary } from "./commentary";
import { getPlayerName } from "./helpers";
import type { MatchSnapshot, SimSpeed, MatchEvent } from "./types";
import { calculateMatchRatings } from "./playerRatings";
import { useSettingsStore } from "../../store/settingsStore";
import { Checkbox } from "../ui";

interface Props {
  snapshot: MatchSnapshot;
  numbers: ReadonlyMap<string, number>;
  speed: SimSpeed;
  paused: boolean;
}

export function LiveMatchView({ snapshot, numbers, speed, paused }: Props) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [sample, setSample] = useState(() =>
    sampleReplay(buildLiveReplay(snapshot, [], numbers), 0),
  );
  const current = useRef(sample);
  const controller = useRef<PlaybackController | null>(null);
  const lastSnapshot = useRef(snapshot);
  const sourceEvents = useRef<readonly MatchEvent[]>([]);
  const rate = useRef(1);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  if (speed !== "paused") rate.current = LIVE_CLIP_MS / LIVE_SPEED_MS[speed];

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
    current.current = sampleReplay(replay, clock.timeMs);
    setSample(current.current);
  }, [snapshot, numbers]);

  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let previous = performance.now();
    let request = 0;
    const tick = (now: number) => {
      const clock = controller.current;
      if (clock?.playing && !paused) {
        if (motion?.matches) clock.seek(clock.replay.durationMs);
        else clock.tick((now - previous) * rate.current);
        current.current = sampleReplay(clock.replay, clock.timeMs);
        setSample(current.current);
      }
      previous = now;
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [paused]);

  const freshCount = sourceEvents.current.length;
  const visibleEventCount =
    snapshot.events.length -
    freshCount +
    Math.min(freshCount, Math.floor((sample.frame.timeMs / LIVE_CLIP_MS) * freshCount));
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

  const event = sample.event ? sourceEvents.current[Number(sample.event.id)] : undefined;
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
      <MatchCanvas
        sample={sample}
        showNumbers
        showCoordinates={false}
        label={t("match.matchView")}
        goalLabel={t("match.eventTypes.Goal")}
        playerLabels={playerLabels}
      />
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
