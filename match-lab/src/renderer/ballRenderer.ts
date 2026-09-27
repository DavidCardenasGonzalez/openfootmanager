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
  const x = air.x;
  const y = air.y - 8;
  ctx.strokeStyle = ball.motion === "shot" ? p.gold : p.white;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, 12, 11, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = p.ink;
  ctx.fillRect(x - 8, y - 8, 16, 16);
  ctx.fillStyle = p.white;
  ctx.fillRect(x - 6, y - 6, 12, 12);
  ctx.fillStyle = p.ink;
  const spin = (Math.floor(timeMs / 95) % 3) * 2;
  ctx.fillRect(x - 4 + spin, y - 4, 4, 4);
  ctx.fillRect(x + 2 - spin, y + 2, 4, 3);
  ctx.restore();
}
