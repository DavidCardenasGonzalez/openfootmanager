import { useEffect, useRef, useState, type ReactNode } from "react";
import { sequences, type SequenceId } from "./mock/sequences";
import { PlaybackController } from "./match/playbackController";
import { sampleReplay } from "./match/interpolation";
import { MatchCanvas } from "./renderer/MatchCanvas";
import { MatchHud } from "./components/MatchHud";
import { DebugControls } from "./components/DebugControls";
import { languages, messages, type Language } from "./i18n";
import type { ReplayData } from "./match/types";

/** Swap this input to change data source; the viewer and renderer stay unchanged. */
export function MatchLab({
  replay,
  language,
  onLanguageChange,
  sequenceSelector,
}: {
  replay: ReplayData;
  language: Language;
  onLanguageChange: (language: Language) => void;
  sequenceSelector: ReactNode;
}) {
  const [controller] = useState(() => new PlaybackController(replay));
  const [sample, setSample] = useState(() => sampleReplay(replay, 0));
  const [numbers, setNumbers] = useState(true);
  const [coordinates, setCoordinates] = useState(false);
  const previous = useRef<number | null>(null);
  const t = messages[language];
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    let handle = 0;
    const animate = (now: number) => {
      if (controller.playing) {
        controller.tick(previous.current === null ? 0 : now - previous.current);
        setSample(sampleReplay(replay, controller.timeMs));
      }
      previous.current = now;
      handle = requestAnimationFrame(animate);
    };
    // Hidden tabs freeze playback instead of skipping an unseen sequence.
    const visibility = () => {
      previous.current = null;
    };
    document.addEventListener("visibilitychange", visibility);
    handle = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(handle);
      document.removeEventListener("visibilitychange", visibility);
      previous.current = null;
    };
  }, [controller, replay]);
  const update = (action: () => void) => {
    action();
    previous.current = null;
    setSample(sampleReplay(replay, controller.timeMs));
  };
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.25em] text-lab-home">
            OpenFootManager / 01
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Match Lab<span className="text-lab-home">.</span>
          </h1>
          <p className="mt-2 text-xs text-lab-muted">{t.subtitle}</p>
        </div>
        <label className="text-xs text-lab-muted">
          {t.language}
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as Language)}
            className="ml-3 max-w-44 cursor-pointer border border-lab-border bg-lab-panel px-3 py-2 text-lab-text"
          >
            {Object.entries(languages).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>
      {sequenceSelector}
      <div className="mb-3 flex items-center justify-between text-xs text-lab-muted">
        <span>{t.replay}</span>
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 ${controller.playing ? "bg-lab-home" : "bg-lab-away"}`} />
          {controller.playing
            ? t.playing
            : controller.timeMs >= replay.durationMs
              ? t.ended
              : t.paused}
        </span>
      </div>
      <div className="border border-lab-border">
        <MatchHud frame={sample.frame} event={sample.event} t={t} kits={__MATCH_LAB_KITS__} />
        <MatchCanvas
          sample={sample}
          kits={__MATCH_LAB_KITS__}
          showNumbers={numbers}
          showCoordinates={coordinates}
          label={t.pitch}
          goalLabel={t.goal}
        />
        <DebugControls
          controller={controller}
          sample={sample}
          onChange={update}
          numbers={numbers}
          coordinates={coordinates}
          setNumbers={setNumbers}
          setCoordinates={setCoordinates}
          t={t}
        />
      </div>
      <footer className="py-5 text-center text-xs text-lab-muted">{t.source}</footer>
    </main>
  );
}
export function App() {
  const [selectedSequence, setSelectedSequence] = useState<SequenceId>("attackingGoal");
  const [language, setLanguage] = useState<Language>("en");
  const t = messages[language];
  const sequence = sequences[selectedSequence];
  return (
    <MatchLab
      key={selectedSequence}
      replay={sequence.replay}
      language={language}
      onLanguageChange={setLanguage}
      sequenceSelector={
        <label className="mb-5 flex flex-wrap items-center gap-3 text-xs text-lab-muted">
          {t.sequence}
          <select
            aria-label={t.sequence}
            value={selectedSequence}
            onChange={(e) => {
              const id = e.target.value;
              if (id in sequences) setSelectedSequence(id as SequenceId);
            }}
            className="min-w-0 max-w-full flex-1 cursor-pointer border border-lab-border bg-lab-panel px-3 py-3 text-lab-text focus-visible:outline-lab-home"
          >
            {Object.entries(sequences).map(([id, entry]) => (
              <option key={id} value={id}>
                {t[entry.labelKey]}
              </option>
            ))}
          </select>
        </label>
      }
    />
  );
}
