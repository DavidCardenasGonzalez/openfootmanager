import { palette as p } from "./palette";
import { groundTransform, project } from "./projection";

export function drawPitch(ctx: CanvasRenderingContext2D) {
  ctx.save();
  groundTransform(ctx);
  ctx.fillStyle = p.grassDark;
  ctx.fillRect(-3, -3, 106, 74);
  ctx.fillStyle = p.turf;
  ctx.fillRect(0, 0, 100, 68);
  ctx.fillStyle = p.stripe;
  for (let x = 0; x < 100; x += 20) ctx.fillRect(x, 0, 10, 68);
  // Deterministic sparse turf flecks: cached with the static ground layer.
  for (let i = 0; i < 380; i++) {
    ctx.fillStyle = i % 3 ? p.grassLight : p.grassDark;
    ctx.fillRect(((i * 733) % 990) / 10, ((i * 359) % 670) / 10, 0.3, 0.15);
  }
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 0.35;
  ctx.strokeRect(0, 0, 100, 68);
  ctx.beginPath();
  ctx.moveTo(50, 0);
  ctx.lineTo(50, 68);
  ctx.stroke();
  const circle = (x: number, y: number, r: number, start = 0, end = Math.PI * 2) => {
    ctx.beginPath();
    ctx.arc(x, y, r, start, end);
    ctx.stroke();
  };
  circle(50, 34, 9.15);
  for (const right of [false, true]) {
    ctx.strokeRect(right ? 84 : 0, 13.84, 16, 40.32);
    ctx.strokeRect(right ? 94.5 : 0, 24.84, 5.5, 18.32);
    circle(
      right ? 89 : 11,
      34,
      9.15,
      right ? Math.PI - 0.99 : -0.99,
      right ? Math.PI + 0.99 : 0.99,
    );
    ctx.fillStyle = p.line;
    ctx.fillRect((right ? 89 : 11) - 0.25, 33.75, 0.5, 0.5);
  }
  ctx.fillStyle = p.line;
  ctx.fillRect(49.7, 33.7, 0.6, 0.6);
  circle(0, 0, 1, 0, Math.PI / 2);
  circle(100, 0, 1, Math.PI / 2, Math.PI);
  circle(0, 68, 1, -Math.PI / 2, 0);
  circle(100, 68, 1, Math.PI, Math.PI * 1.5);
  ctx.restore();
  for (const [x, y] of [
    [0, 0],
    [100, 0],
    [0, 68],
    [100, 68],
  ]) {
    const point = project(x, y);
    ctx.fillStyle = p.ink;
    ctx.fillRect(point.x - 1, point.y - 18, 3, 19);
    ctx.fillStyle = p.gold;
    ctx.fillRect(point.x + 2, point.y - 18, 9, 6);
  }
}

/** Upright goal cage projected from the same ground plane as the players. */
export function drawGoal(ctx: CanvasRenderingContext2D, right: boolean) {
  const x = right ? 100 : 0;
  const back = right ? 104 : -4;
  const low = 30.34;
  const high = 37.66;
  const height = 3.7;
  const segment = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const a = project(ax, ay, az);
    const b = project(bx, by, bz);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  ctx.strokeStyle = p.net;
  ctx.lineWidth = 1;
  // Back net, roof and side meshes; transparent enough to track the ball.
  for (let y = low; y <= high; y += 0.9) {
    segment(back, y, 0, back, y, height);
    segment(x, y, height, back, y, height);
  }
  for (let z = 0; z <= height; z += 0.65) {
    segment(back, low, z, back, high, z);
    segment(x, low, z, back, low, z);
    segment(x, high, z, back, high, z);
  }
  ctx.strokeStyle = p.concreteLight;
  ctx.lineWidth = 2;
  segment(back, low, 0, back, low, height);
  segment(back, high, 0, back, high, height);
  ctx.strokeStyle = p.white;
  ctx.lineWidth = 3;
  segment(x, low, 0, x, low, height);
  segment(x, high, 0, x, high, height);
  segment(x, low, height, x, high, height);
  segment(x, low, height, back, low, height);
  segment(x, high, height, back, high, height);
}
