import type { PlaybackController, PlaybackSpeed } from "../match/playbackController";
import type { RenderSample } from "../match/types";
import { eventLabel, type Messages } from "../i18n";
import { clock } from "./MatchHud";
interface Props {
  controller: PlaybackController;
  sample: RenderSample;
  onChange: (action: () => void) => void;
  numbers: boolean;
  coordinates: boolean;
  setNumbers: (value: boolean) => void;
  setCoordinates: (value: boolean) => void;
  t: Messages;
}
const button =
  "cursor-pointer border border-lab-border px-4 py-2.5 text-xs font-bold transition-colors hover:border-lab-home focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lab-home disabled:cursor-default disabled:opacity-40";
export function DebugControls({
  controller: c,
  sample,
  onChange,
  numbers,
  coordinates,
  setNumbers,
  setCoordinates,
  t,
}: Props) {
  return (
    <>
      <section
        className="space-y-5 border-t border-lab-border bg-lab-panel p-5"
        aria-label={t.timeline}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${button} bg-lab-home text-lab-bg`}
            disabled={c.playing}
            onClick={() => onChange(() => c.play())}
          >
            ▶ {t.play}
          </button>
          <button
            type="button"
            className={button}
            disabled={!c.playing}
            onClick={() => onChange(() => c.pause())}
          >
            Ⅱ {t.pause}
          </button>
          <button type="button" className={button} onClick={() => onChange(() => c.reset())}>
            ↺ {t.reset}
          </button>
          <button
            type="button"
            className={button}
            disabled={c.timeMs >= c.replay.durationMs}
            onClick={() => onChange(() => c.step())}
          >
            ▸| {t.step}
          </button>
          <fieldset className="flex items-center gap-1 sm:ml-auto" aria-label={t.speed}>
            {([0.5, 1, 2, 4] as PlaybackSpeed[]).map((speed) => (
              <button
                type="button"
                key={speed}
                aria-pressed={c.speed === speed}
                className={`${button} ${c.speed === speed ? "border-lab-home text-lab-home" : "text-lab-muted"}`}
                onClick={() => onChange(() => c.setSpeed(speed))}
              >
                {speed}×
              </button>
            ))}
          </fieldset>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs tabular-nums text-lab-muted">{clock(c.timeMs / 1000)}</span>
          <input
            type="range"
            min={0}
            max={c.replay.durationMs}
            step={10}
            value={c.timeMs}
            aria-label={t.progress}
            className="h-2 min-w-0 flex-1 cursor-pointer accent-lab-home"
            onChange={(e) => onChange(() => c.seek(Number(e.target.value)))}
          />
          <span className="text-xs tabular-nums text-lab-muted">
            {clock(c.replay.durationMs / 1000)}
          </span>
        </div>
        <div className="flex flex-wrap gap-6 text-xs text-lab-muted">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="accent-lab-home"
              checked={numbers}
              onChange={(e) => setNumbers(e.target.checked)}
            />
            {t.numbers}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="accent-lab-home"
              checked={coordinates}
              onChange={(e) => setCoordinates(e.target.checked)}
            />
            {t.coordinates}
          </label>
          <span className="sm:ml-auto">
            {t.frame} {sample.frameIndex.toString().padStart(3, "0")} / {c.replay.frames.length - 1}
          </span>
        </div>
      </section>
      <section className="mt-6 border border-lab-border bg-lab-panel p-5">
        <h2 className="mb-4 text-xs uppercase tracking-widest text-lab-muted">{t.timeline}</h2>
        <div className="flex flex-wrap gap-2">
          {c.replay.events.map((event) => (
            <button
              type="button"
              key={event.id}
              aria-pressed={sample.event?.id === event.id}
              onClick={() =>
                onChange(() => {
                  c.pause();
                  c.seek(event.timeMs);
                })
              }
              className={`${button} ${sample.event?.id === event.id ? "border-lab-home bg-lab-bg text-lab-home" : "text-lab-muted"}`}
            >
              <span className="mr-2 opacity-60">{clock(event.timeMs / 1000)}</span>
              {eventLabel(event, t)}
            </button>
          ))}
        </div>
        <details className="mt-5 border-t border-lab-border pt-4 text-xs">
          <summary className="cursor-pointer text-lab-muted">{t.inspector}</summary>
          <pre className="mt-3 max-h-72 overflow-auto bg-lab-bg p-4 text-lab-home">
            {JSON.stringify(
              {
                replayId: c.replay.id,
                frameIndex: sample.frameIndex,
                nextFrameIndex: sample.nextFrameIndex,
                alpha: Number(sample.alpha.toFixed(3)),
                event: sample.event,
                recorded: c.replay.frames[sample.frameIndex],
                rendered: sample.frame,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>
    </>
  );
}
