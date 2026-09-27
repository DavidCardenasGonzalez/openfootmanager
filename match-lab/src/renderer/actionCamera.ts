import type { Position } from "../match/types";
import { project, viewport } from "./projection";

/** Broad framing rather than chasing the ball: no accumulated camera state, so
 * pausing, stepping and seeking always produce the same composition. */
export function actionCamera(ball: Position, enabled = true) {
  if (!enabled) return { x: 0, y: 0, zoom: 1 };
  const zoom = 1.25;
  const focus = project(ball.x, ball.y);
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const bounded = (offset: number, size: number) =>
    Math.max(size * (1 - zoom), Math.min(0, offset));
  return {
    zoom,
    x: bounded(centerX - (centerX + (focus.x - centerX) * 0.4) * zoom, viewport.width),
    y: bounded(centerY - (centerY + (focus.y - centerY) * 0.4) * zoom, viewport.height),
  };
}
