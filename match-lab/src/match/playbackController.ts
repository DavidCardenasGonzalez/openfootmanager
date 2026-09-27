import type { ReplayData } from "./types";
export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

/** Pure clock: no React, canvas, data loading, or wall-clock dependencies. */
export class PlaybackController {
  timeMs = 0;
  playing = false;
  speed: PlaybackSpeed = 1;
  constructor(readonly replay: ReplayData) {}
  play() {
    if (this.timeMs >= this.replay.durationMs) this.timeMs = 0;
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  reset() {
    this.timeMs = 0;
    this.pause();
  }
  setSpeed(speed: PlaybackSpeed) {
    this.speed = speed;
  }
  seek(timeMs: number) {
    if (!Number.isFinite(timeMs)) return;
    this.timeMs = Math.max(0, Math.min(this.replay.durationMs, timeMs));
    if (this.timeMs === this.replay.durationMs) this.pause();
  }
  step() {
    this.pause();
    this.seek(
      this.replay.frames.find((f) => f.timeMs > this.timeMs)?.timeMs ?? this.replay.durationMs,
    );
  }
  tick(deltaMs: number) {
    if (this.playing && Number.isFinite(deltaMs) && deltaMs >= 0)
      this.seek(this.timeMs + deltaMs * this.speed);
  }
}
