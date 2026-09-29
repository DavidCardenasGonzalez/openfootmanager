import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import type { MatchEvent } from "./types";

const incidents = new Set(["Goal", "PenaltyGoal", "Foul", "YellowCard", "RedCard", "SecondYellow"]);
export const isCinematicEvent = (event: MatchEvent) => incidents.has(event.event_type);

interface Props {
  event: MatchEvent;
  playerName: string;
  teamName: string;
}

/** An announcement tied to replay time, leaving the pitch and controls active. */
export function MatchCinematic({ event, playerName, teamName }: Props) {
  const { t } = useTranslation();
  const goal = event.event_type === "Goal" || event.event_type === "PenaltyGoal";
  const foul = event.event_type === "Foul";
  const red = event.event_type === "RedCard" || event.event_type === "SecondYellow";
  return (
    <div
      role="status"
      aria-label={t(`match.eventTypes.${event.event_type}`)}
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3"
    >
      <div
        className={
          goal
            ? "flex max-w-full flex-col items-center gap-2 rounded-2xl border-2 border-accent-400 bg-navy-900/95 px-8 py-4 text-center text-white shadow-2xl dark:border-accent-400 dark:bg-navy-900/95 dark:text-white sm:px-12 sm:py-5"
            : "flex max-w-full items-center gap-3 rounded-xl border border-accent-400 bg-white/95 px-4 py-2 text-gray-900 shadow-lg dark:border-accent-400 dark:bg-navy-900/95 dark:text-white"
        }
      >
        {goal ? null : foul ? (
          <Flag
            aria-hidden="true"
            className="h-8 w-8 shrink-0 text-primary-700 dark:text-primary-400"
          />
        ) : (
          <span
            aria-hidden="true"
            className={`h-8 w-5 shrink-0 rounded-sm ${red ? "bg-red-600 dark:bg-red-500" : "bg-accent-400 dark:bg-accent-400"}`}
          />
        )}
        <div className="min-w-0">
          <p
            className={
              goal
                ? "font-heading text-6xl font-black uppercase leading-none tracking-wider text-accent-400 dark:text-accent-400 sm:text-8xl"
                : "font-heading text-2xl font-bold uppercase tracking-wide"
            }
          >
            {t(`match.eventTypes.${goal ? "Goal" : event.event_type}`)}
          </p>
          {event.event_type === "PenaltyGoal" && (
            <p className="mt-1 font-heading text-lg uppercase">
              {t("match.eventTypes.PenaltyGoal")}
            </p>
          )}
          <p
            className={
              goal
                ? "mt-3 text-sm font-semibold text-white dark:text-white sm:text-lg"
                : "truncate text-xs text-gray-600 dark:text-gray-300"
            }
          >
            {event.minute}′ · {playerName} · {teamName}
          </p>
        </div>
      </div>
    </div>
  );
}
