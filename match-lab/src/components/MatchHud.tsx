import type { MatchFrame, MatchEvent } from "../match/types";
import { eventLabel, type Messages } from "../i18n";
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
export function MatchHud({
  frame,
  event,
  t,
}: {
  frame: MatchFrame;
  event?: MatchEvent;
  t: Messages;
}) {
  return (
    <div className="border-b border-lab-border bg-lab-panel">
      <div className="flex flex-wrap items-center justify-center gap-4 px-4 py-6 sm:gap-9">
        <div className="flex items-center gap-3 text-sm font-bold uppercase text-lab-home">
          <span className="h-4 w-3 bg-lab-home" />
          {t.home}
        </div>
        <div className="text-center">
          <div className="text-4xl font-bold tracking-widest tabular-nums">
            {frame.score.home}
            <span className="px-2 text-lab-muted">:</span>
            {frame.score.away}
          </div>
          <div className="mt-2 text-xs tabular-nums text-lab-muted">
            {clock(frame.matchTimeSeconds)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-bold uppercase text-lab-away">
          {t.away}
          <span className="h-4 w-3 bg-lab-away" />
        </div>
      </div>
      <div
        className="flex min-h-10 items-center justify-center gap-3 border-t border-lab-border px-4 py-2 text-xs"
        aria-live="polite"
      >
        <span className="text-lab-home">
          {event?.from ? `#${event.from}${event.to ? ` → #${event.to}` : ""}` : "◆"}
        </span>
        <span>{eventLabel(event, t)}</span>
      </div>
    </div>
  );
}
