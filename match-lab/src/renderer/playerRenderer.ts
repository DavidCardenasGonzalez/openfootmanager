import type { PlayerState, MatchFrame, MatchEvent } from "../match/types";
import { palette as p } from "./palette";
import { project, projectDirection } from "./projection";
const digits = [
  "111101101101111",
  "010110010010111",
  "111001111100111",
  "111001111001111",
  "101101111001001",
  "111100111001111",
  "111100111101111",
  "111001010010010",
  "111101111101111",
  "111101111001111",
];
function shirtNumber(ctx: CanvasRenderingContext2D, value: number, y: number) {
  const text = String(value);
  ctx.fillStyle = p.ink;
  for (let i = 0; i < text.length; i++) {
    const glyph = digits[Number(text[i])];
    for (let n = 0; n < 15; n++)
      if (glyph[n] === "1") {
        ctx.fillRect(Math.floor(-text.length * 2 + i * 4 + (n % 3)), y + Math.floor(n / 3), 1, 1);
      }
  }
}
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: PlayerState,
  frame: MatchFrame,
  selected: boolean,
  showNumbers: boolean,
  event?: MatchEvent,
) {
  const timeMs = frame.timeMs;
  const age = Math.max(0, timeMs - (event?.timeMs ?? timeMs));
  const nearBall = Math.hypot(player.x - frame.ball.x, player.y - frame.ball.y);
  const defending = player.goalkeeper && player.team !== event?.team && nearBall < 20;
  const dive =
    defending && frame.ball.motion === "shot"
      ? Math.max(0, Math.min(1, (age - 600) / 300))
      : defending && event?.kind === "goal"
        ? Math.max(0, 1 - Math.max(0, age - 1200) / 500)
        : 0;
  const celebrate =
    event?.kind === "goal" && player.team === event.team && !player.goalkeeper && nearBall < 30;
  const receiving = selected && player.action === "idle";
  const windup = selected && (player.action === "pass" || player.action === "shoot");
  const point = project(player.x, player.y);
  const facing = projectDirection(
    dive > 0 ? Math.atan2(frame.ball.y - player.y, frame.ball.x - player.x) : player.direction,
  );
  const side = facing.x >= 0 ? 1 : -1;
  const back = facing.y < -0.25;
  const running = player.action === "run";
  const kicking = player.action === "pass" || player.action === "shoot";
  const phase = Math.floor(timeMs / 110 + player.shirtNumber) % 4;
  const stride = running ? [-2, 0, 2, 0][phase] : 0;
  // One wind-up/contact/follow-through per event, never a looping kick.
  const releaseDelay = event?.kind === "shot" ? 400 : event?.kind === "attack" ? 300 : 0;
  const followThrough = Math.max(0, 1 - Math.max(0, age - releaseDelay) / 300);
  const kick = windup
    ? -3 * Math.min(1, age / Math.max(1, releaseDelay))
    : kicking
      ? (player.action === "shoot" ? 8 : 5) * followThrough
      : receiving
        ? 2
        : 0;
  const bob =
    receiving || (defending && event?.kind === "shot" && dive === 0)
      ? -2
      : running
        ? phase % 2
        : kicking
          ? -1
          : Math.floor(timeMs / 700 + player.shirtNumber) % 2;
  const kit = player.goalkeeper
    ? player.team === "home"
      ? p.homeKeeper
      : p.awayKeeper
    : p[player.team];
  const shade = player.goalkeeper
    ? p.concreteDark
    : player.team === "home"
      ? p.homeShade
      : p.awayShade;
  const skin = player.shirtNumber % 3 === 0 ? p.skinDark : p.skin;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.fillStyle = p.shadow;
  ctx.beginPath();
  ctx.ellipse(3, 2, 15, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = p.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 19, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (celebrate) {
    const hop = Math.max(0, Math.sin(age / 150));
    ctx.translate(0, -hop * (player.shirtNumber === event?.from ? 10 : 5));
  }
  if (dive > 0) {
    ctx.translate(0, -8 * Math.sin(dive * Math.PI));
    ctx.rotate((Math.atan2(facing.y, facing.x) + Math.PI / 2) * dive);
  } else if (windup) ctx.rotate(-side * 0.09);
  ctx.scale(2, 2);
  // Sprite pixels: upright billboards on the projected ground, never skewed with it.
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const leg = (x: number, offset: number, active: boolean) => {
    const kx = active ? Math.round(facing.x * kick) : 0;
    const ky = active ? Math.round(facing.y * kick * 0.4) - Math.floor(kick / 3) : 0;
    rect(p.ink, x + kx - 1, -7 + offset + ky, 5, 8);
    rect(skin, x + kx, -7 + offset + ky, 3, 3);
    rect(player.team === "home" ? p.white : kit, x + kx, -4 + offset + ky, 3, 3);
    rect(p.ink, x + kx + (side > 0 ? 0 : -2), -1 + offset + ky, 5, 2);
  };
  leg(-4, stride, side < 0);
  leg(2, -stride, side > 0);
  const body = -15 - bob;
  rect(p.ink, -6, body - 1, 13, 12);
  rect(kit, -5, body, 11, 9);
  rect(shade, -5, body + 7, 11, 2);
  rect(player.team === "away" && !player.goalkeeper ? p.white : p.ink, -5, body + 9, 11, 4);
  // Collar and shoulder piping improve kit readability at low resolution.
  rect(p.white, -5, body, 3, 1);
  rect(p.white, 3, body, 3, 1);
  rect(p.ink, -1, body, 3, 2);
  for (const arm of [-1, 1]) {
    const swing = celebrate
      ? -10
      : dive > 0
        ? -7
        : receiving
          ? -2
          : kicking
            ? arm === side
              ? -3
              : 1
            : arm * stride;
    const x = arm < 0 ? -9 : 7;
    rect(p.ink, x, body + 1 + swing, 4, 8);
    rect(kit, x + 1, body + 1 + swing, 3, 4);
    rect(player.goalkeeper ? p.white : skin, x + 1, body + 5 + swing, 3, 3);
  }
  // Chunky head, outlined hair, face direction, and a small highlight.
  rect(p.ink, -4, body - 9, 9, 9);
  rect(skin, -3, body - 8, 7, 7);
  rect(player.shirtNumber % 4 === 0 ? p.gold : p.hair, -4, body - 10, 9, 4);
  rect(p.hair, back ? -3 : -side * 3, body - 6, back ? 7 : 2, back ? 3 : 4);
  if (!back) {
    rect(skin, side > 0 ? 4 : -5, body - 5, 2, 2);
    rect(p.ink, side > 0 ? 2 : -3, body - 6, 1, 1);
  }
  if (showNumbers) shirtNumber(ctx, player.shirtNumber, body + 2);
  if (selected) {
    rect(p.gold, -3, body - 17, 7, 2);
    rect(p.gold, -2, body - 15, 5, 2);
    rect(p.gold, 0, body - 13, 1, 1);
  }
  ctx.restore();
}
