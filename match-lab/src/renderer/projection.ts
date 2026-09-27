import type { Position } from "../match/types";

/** Presentation-only affine camera. Simulation coordinates remain 100 × 68. */
export const viewport = { width: 1120, height: 800, pixelScale: 2 };
const camera = { x: 400, y: 190, xx: 6.05, xy: 2.4, yx: -4.1, yy: 3.65, height: 9 };
export function project(x: number, y: number, height = 0): Position {
  return {
    x: camera.x + x * camera.xx + y * camera.yx,
    y: camera.y + x * camera.xy + y * camera.yy - height * camera.height,
  };
}
export function projectDirection(radians: number): Position {
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  const dx = x * camera.xx + y * camera.yx;
  const dy = x * camera.xy + y * camera.yy;
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}
export function sortByDepth<T extends Position>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => project(a.x, a.y).y - project(b.x, b.y).y);
}
export function groundTransform(ctx: CanvasRenderingContext2D) {
  ctx.transform(camera.xx, camera.xy, camera.yx, camera.yy, camera.x, camera.y);
}
