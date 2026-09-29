import type { Joint } from "./playerPose";
/** Scanline rasterization keeps diagonal anatomy on a one-pixel grid, without blurred paths. */
export function pixelPolygon(
  ctx: CanvasRenderingContext2D,
  color: string,
  points: readonly Joint[],
) {
  ctx.fillStyle = color;
  const min = Math.floor(Math.min(...points.map((p) => p[1])));
  const max = Math.ceil(Math.max(...points.map((p) => p[1])));
  for (let y = min; y < max; y++) {
    const hits: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5))
        hits.push(a[0] + ((y + 0.5 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const x = Math.round(hits[i]);
      ctx.fillRect(x, y, Math.max(1, Math.round(hits[i + 1]) - x), 1);
    }
  }
}
export function pixelLimb(
  ctx: CanvasRenderingContext2D,
  color: string,
  a: Joint,
  b: Joint,
  width: number,
) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dx = (((b[1] - a[1]) / length) * width) / 2;
  const dy = (((a[0] - b[0]) / length) * width) / 2;
  pixelPolygon(ctx, color, [
    [a[0] - dx, a[1] - dy],
    [b[0] - dx, b[1] - dy],
    [b[0] + dx, b[1] + dy],
    [a[0] + dx, a[1] + dy],
  ]);
}
