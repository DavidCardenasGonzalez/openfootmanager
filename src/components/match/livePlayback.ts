import type { PlaybackController } from "../../../match-lab/src/match/playbackController";

/** Goals use real time so even maximum speed leaves a readable celebration.
 * Split at event boundaries so a long animation frame cannot skip a goal. */
export function advanceLivePlayback(clock: PlaybackController, elapsedMs: number, rate: number) {
  let remaining = Math.max(0, elapsedMs);
  while (clock.playing && remaining > 0) {
    const active = [...clock.replay.events].reverse().find((e) => e.timeMs <= clock.timeMs);
    const speed = active?.kind === "goal" ? Math.min(1, rate) : rate;
    const next = clock.replay.events.find((e) => e.timeMs > clock.timeMs);
    const boundary = next?.timeMs ?? clock.replay.durationMs;
    const duration = (boundary - clock.timeMs) / speed;
    if (remaining < duration) {
      clock.tick(remaining * speed);
      return;
    }
    clock.seek(boundary);
    // Always render the first confirmed frame, including after a background-tab stall.
    if (next?.kind === "goal") return;
    remaining -= duration;
  }
}
