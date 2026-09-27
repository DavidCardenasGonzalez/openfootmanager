import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import type { MatchEvent } from "./types";

const incidents = new Set(["Goal", "PenaltyGoal", "Foul", "YellowCard", "RedCard", "SecondYellow"]);
export const isCinematicEvent = (event: MatchEvent) => incidents.has(event.event_type);

interface Props {
  event: MatchEvent;
  playerName: string;
  teamName: string;
  onContinue: () => void;
}

/** A presentation-only interruption. Native dialog keeps focus inside and the match inert. */
export function MatchCinematic({ event, playerName, teamName, onContinue }: Props) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLDivElement>(null);
  const title = useId();
  const goal = event.event_type === "Goal" || event.event_type === "PenaltyGoal";
  const foul = event.event_type === "Foul";
  const red = event.event_type === "RedCard" || event.event_type === "SecondYellow";
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    button.current?.querySelector("button")?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        onContinue();
      }}
      className="m-auto w-full max-w-lg overflow-hidden rounded-2xl border-2 border-accent-400 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-navy-900/80 dark:bg-navy-900 dark:text-white"
    >
      <div
        className="relative flex h-48 items-center justify-center overflow-hidden bg-primary-800 dark:bg-primary-900"
        aria-hidden="true"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 240 120"
          className="h-40 w-80 text-white"
          fill="currentColor"
          shapeRendering="crispEdges"
        >
          <path d="M0 106H240M120 106V120" stroke="currentColor" strokeWidth="2" />
          {goal ? (
            <>
              <path
                d="M64 100V25H190V100M64 25L80 12H208V86L190 100M190 25L208 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                d="M82 26V100M100 26V100M118 26V100M136 26V100M154 26V100M172 26V100M64 45H190M64 63H190M64 81H190"
                fill="none"
                stroke="currentColor"
                opacity="0.4"
              />
              <g className="motion-safe:animate-bounce">
                <path d="M129 68H141V72H147V88H141V92H129V88H123V72H129Z" />
                <path d="M130 74H140V84H130Z" className="text-navy-900" />
              </g>
              <path
                d="M28 36H34V42H28ZM212 40H218V46H212ZM40 70H46V76H40Z"
                className="text-accent-400 motion-safe:animate-pulse"
              />
            </>
          ) : (
            <>
              <rect x="103" y="38" width="24" height="24" className="text-accent-400" />
              <rect x="98" y="62" width="34" height="28" className="text-navy-900" />
              <path
                d="M100 88H111V106H100ZM121 88H132V106H121ZM88 66H100V76H88ZM131 57H142V70H131ZM140 41H150V60H140Z"
                className="text-navy-900"
              />
              {foul ? (
                <path
                  d="M149 37H176V44H149ZM157 28H175V33H157ZM157 48H175V53H157Z"
                  className="motion-safe:animate-pulse"
                />
              ) : (
                <g className="motion-safe:animate-pulse">
                  {event.event_type === "SecondYellow" && (
                    <rect x="150" y="16" width="20" height="29" className="text-accent-400" />
                  )}
                  <rect
                    x="137"
                    y="11"
                    width="20"
                    height="29"
                    className={red ? "text-red-500" : "text-accent-400"}
                  />
                </g>
              )}
            </>
          )}
        </svg>
      </div>
      <div className="space-y-4 p-6 text-center" aria-live="polite" aria-atomic="true">
        <p className="font-heading text-sm uppercase tracking-widest text-gray-500 dark:text-gray-400">
          {event.minute}′ · {teamName}
        </p>
        <h2 id={title} className="font-heading text-5xl font-bold uppercase tracking-wide">
          {t(`match.eventTypes.${event.event_type}`)}
        </h2>
        <p className="text-xl font-semibold">{playerName}</p>
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("match.cinematicPause")}</p>
        <div ref={button}>
          <Button onClick={onContinue}>{t("match.continue")}</Button>
        </div>
      </div>
    </dialog>
  );
}
