import { palette as p } from "./palette";
import { groundTransform, project, viewport } from "./projection";

function wall(
  ctx: CanvasRenderingContext2D,
  a: readonly [number, number],
  b: readonly [number, number],
  height: number,
) {
  const s = project(...a);
  const e = project(...b);
  ctx.fillStyle = p.concreteDark;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(e.x, e.y);
  ctx.lineTo(e.x, e.y - height);
  ctx.lineTo(s.x, s.y - height);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = p.concreteLight;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - height);
  ctx.lineTo(e.x, e.y - height);
  ctx.stroke();
  ctx.strokeStyle = p.trackEdge;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - 3);
  ctx.lineTo(e.x, e.y - 3);
  ctx.stroke();
}
function spectator(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number) {
  const colors = [p.homeShade, p.awayShade, p.gold, p.home, p.concreteLight, p.away];
  const raised = seed % 5 === 0;
  ctx.fillStyle = p.ink;
  ctx.fillRect(x - 5, y - 12, 12, 14);
  ctx.fillStyle = colors[seed % colors.length];
  ctx.fillRect(x - 4, y - 12, 10, 9);
  ctx.fillRect(x - 7, y - (raised ? 19 : 11), 3, raised ? 12 : 6);
  ctx.fillStyle = seed % 3 ? p.skin : p.skinDark;
  ctx.fillRect(x - 3, y - 20, 7, 8);
  ctx.fillStyle = p.hair;
  ctx.fillRect(x - 3, y - 21, 7, 3);
  if (raised) {
    ctx.fillStyle = p.skin;
    ctx.fillRect(x - 7, y - 22, 3, 4);
  }
  if (seed % 13 === 0) {
    ctx.fillStyle = p.white;
    ctx.fillRect(x + 7, y - 34, 2, 24);
    ctx.fillStyle = colors[(seed + 1) % colors.length];
    ctx.fillRect(x + 9, y - 34, 13, 8);
  }
}
function terrace(ctx: CanvasRenderingContext2D, side: "top" | "left") {
  // Draw far rows first. Steps and spectators are pre-rendered once, not every frame.
  for (let row = 4; row >= 0; row--) {
    const offset = -10 - row * 4;
    const lift = row * 7;
    const a = side === "top" ? project(-5, offset) : project(offset, -4);
    const b = side === "top" ? project(104, offset) : project(offset, 73);
    ctx.strokeStyle = row % 2 ? p.seat : p.concreteDark;
    ctx.lineWidth = 23;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - lift);
    ctx.lineTo(b.x, b.y - lift);
    ctx.stroke();
    const count = side === "top" ? 40 : 23;
    for (let i = 0; i < count; i++) {
      // Leave small access stairwells between blocks of spectators.
      if (i % 13 === 12) continue;
      const t = (i + 0.5 + (row % 2) * 0.22) / count;
      spectator(
        ctx,
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t - lift,
        row * 41 + i + (side === "top" ? 1 : 3),
      );
    }
  }
}
function floodlight(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = p.concreteDark;
  ctx.fillRect(x - 3, y, 6, 95);
  ctx.fillStyle = p.concreteLight;
  ctx.fillRect(x - 1, y, 2, 95);
  ctx.fillStyle = p.ink;
  ctx.fillRect(x - 25, y - 20, 52, 24);
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 5; col++) {
      ctx.fillStyle = p.gold;
      ctx.fillRect(x - 20 + col * 9, y - 16 + row * 9, 7, 7);
      ctx.fillStyle = p.white;
      ctx.fillRect(x - 19 + col * 9, y - 15 + row * 9, 5, 4);
    }
}
export function drawStadium(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = p.surround;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = p.sky;
  ctx.fillRect(0, 0, viewport.width, 260);
  ctx.fillStyle = p.cloud;
  for (let i = 0; i < 10; i++) {
    const x = (i * 173) % 1100;
    const y = 20 + ((i * 31) % 120);
    ctx.fillRect(x, y, 44, 8);
    ctx.fillRect(x + 12, y - 7, 24, 7);
  }
  ctx.fillStyle = p.concreteDark;
  for (let i = 0; i < 25; i++) ctx.fillRect(i * 49, 150 - ((i * 17) % 57), 38, 120);
  // Flat concourse outside the pitch and a warm track just inside the barriers.
  ctx.save();
  groundTransform(ctx);
  ctx.fillStyle = p.concreteDark;
  ctx.fillRect(-29, -29, 158, 126);
  ctx.fillStyle = p.trackEdge;
  ctx.fillRect(-8, -8, 116, 84);
  ctx.fillStyle = p.track;
  ctx.fillRect(-6, -6, 112, 80);
  ctx.restore();
  terrace(ctx, "top");
  terrace(ctx, "left");
  wall(ctx, [-7, -7], [107, -7], 20);
  wall(ctx, [-7, -7], [-7, 75], 20);
  // Original abstract pennants and advertising blocks, no brands or club assets.
  for (let i = 0; i < 12; i++) {
    const s = project(i * 9, -7);
    ctx.fillStyle = i % 3 === 0 ? p.gold : i % 2 ? p.homeShade : p.banner;
    ctx.fillRect(s.x - 10, s.y - 17, 21, 10);
    ctx.fillStyle = p.white;
    ctx.fillRect(s.x - 6, s.y - 14, 10, 2);
  }
  floodlight(ctx, 160, 100);
  floodlight(ctx, 760, 35);
}
export function drawForeground(ctx: CanvasRenderingContext2D) {
  wall(ctx, [-7, 76], [108, 76], 12);
  wall(ctx, [108, -7], [108, 76], 12);
  // Sparse near-side spectators create depth without obscuring the touchline.
  for (let i = 0; i < 33; i++) {
    const point = project(i * 3.5 - 5, 85);
    spectator(ctx, point.x, point.y, i * 7);
  }
}
