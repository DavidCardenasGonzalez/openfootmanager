import type { BallState } from "../match/types";
import { palette as p } from "./palette";
import { project } from "./projection";
export function drawBall(ctx: CanvasRenderingContext2D, ball: BallState, timeMs: number) {
  const ground = project(ball.x, ball.y);
  const air = project(ball.x, ball.y, ball.height);
  ctx.save();
  ctx.fillStyle = p.shadow;
  ctx.beginPath();
  ctx.ellipse(ground.x + 2, ground.y + 2, 10 + ball.height * 0.7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  if (ball.height > 1) {
    // Broken vertical guide ties a lofted pass to its landing footprint.
    ctx.fillStyle = p.line;
    for (let y = air.y + 9; y < ground.y - 3; y += 8) ctx.fillRect(ground.x, y, 2, 3);
  }
  // Pixel-stepped round silhouette with one-pixel seams, at the same world size.
  const x = Math.round(air.x);
  const y = Math.round(air.y - 8);
  ctx.strokeStyle = ball.motion === "shot" ? p.gold : p.white;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, 11, 10, 0, 0, Math.PI * 2);
  ctx.stroke();
  const rect = (color: string, dx: number, dy: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + dx, y + dy, w, h);
  };
  rect(p.ink, -4, -8, 8, 16);
  rect(p.ink, -6, -6, 12, 12);
  rect(p.ink, -8, -4, 16, 8);
  rect(p.white, -3, -7, 6, 14);
  rect(p.white, -5, -5, 10, 10);
  rect(p.white, -7, -3, 14, 6);
  rect(p.net, -3, 5, 6, 2);
  rect(p.net, 5, -2, 2, 5);
  const spin = Math.floor(timeMs / 95) % 3;
  rect(p.ink, -3 + spin, -3, 3, 1);
  rect(p.ink, -4 + spin, -2, 5, 3);
  rect(p.ink, -3 + spin, 1, 3, 1);
  rect(p.ink, 3 - spin, 3, 2, 2);
  rect(p.net, -5 + spin, -4, 1, 3);
  rect(p.net, 2 + spin, -1, 3, 1);
  ctx.restore();
}
