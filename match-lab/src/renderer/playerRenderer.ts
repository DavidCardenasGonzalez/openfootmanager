import type { PlayerState, MatchFrame, MatchEvent } from "../match/types";
import { palette as p } from "./palette";
import { project, projectDirection } from "./projection";
import { resolveMatchKits, spriteKit, type MatchKits } from "./kits";
import { playerPose, type Joint } from "./playerPose";
import { pixelLimb, pixelPolygon } from "./pixelFigure";
const defaultKits = resolveMatchKits();
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
function shirtNumber(ctx: CanvasRenderingContext2D, value: number, y: number, color: string) {
  const text = String(value);
  ctx.fillStyle = color;
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
  kits: MatchKits = defaultKits,
) {
  const timeMs = frame.timeMs;
  const age = Math.max(0, timeMs - (event?.timeMs ?? timeMs));
  const nearBall = Math.hypot(player.x - frame.ball.x, player.y - frame.ball.y);
  const saved = player.goalkeeper && event?.kind === "save" && frame.ball.ownerId === player.id;
  const defending = player.goalkeeper && (player.team !== event?.team || saved) && nearBall < 20;
  const dive =
    defending && frame.ball.motion === "shot"
      ? Math.max(0, Math.min(1, (age - 600) / 300))
      : defending && (event?.kind === "goal" || saved)
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
  const gaitTime = timeMs + player.shirtNumber * 71;

  // One wind-up/contact/follow-through per event, never a looping kick.
  const releaseDelay =
    event?.kind === "shot"
      ? 400
      : event?.kind === "attack" || event?.kind === "throughBall"
        ? 300
        : 0;
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
        ? Math.abs(Math.sin(((gaitTime % 640) / 640) * Math.PI * 2)) * 0.65
        : kicking
          ? -1
          : Math.floor(timeMs / 700 + player.shirtNumber) % 2;
  const uniform = spriteKit(
    player.goalkeeper
      ? {
          pattern: "Solid",
          colors: {
            primary: player.team === "home" ? p.homeKeeper : p.awayKeeper,
            secondary: p.ink,
          },
        }
      : kits[player.team],
  );
  const kit = uniform.shirt;
  const skin = player.shirtNumber % 3 === 0 ? p.skinDark : p.skin;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.fillStyle = p.shadow;
  ctx.beginPath();
  ctx.ellipse(2, 2, 13, 4, 0, 0, Math.PI * 2);
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
  // Draw at native resolution: a smaller head, longer articulated legs and a
  // shaped torso replace the old doubled rectangular sprite.
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const pose = playerPose(gaitTime, running, side, kick, celebrate || dive > 0, facing);
  const limb = (a: Joint, b: Joint, color: string, width: number) => {
    pixelLimb(ctx, p.ink, a, b, width + 2);
    pixelLimb(ctx, color, a, b, width);
  };
  for (const [hip, knee, ankle] of pose.legs) {
    limb(hip, knee, skin, 4);
    limb(knee, ankle, uniform.socks, 4);
    rect(uniform.trim, knee[0] - 2, knee[1], 4, 2);
    rect(p.ink, ankle[0] - 3 + side, ankle[1], 7, 3);
    rect(p.concreteLight, ankle[0] + (side > 0 ? 2 : -2), ankle[1], 2, 1);
  }
  const arm = (index: number) => {
    const [shoulder, elbow, hand] = pose.arms[index];
    limb(shoulder, elbow, skin, 4);
    limb(elbow, hand, skin, 3);
    const cuff: Joint = [
      shoulder[0] + (elbow[0] - shoulder[0]) * 0.5,
      shoulder[1] + (elbow[1] - shoulder[1]) * 0.5,
    ];
    limb(shoulder, cuff, kit, 5);
    rect(uniform.trim, cuff[0] - 2, cuff[1], 4, 1);
    rect(player.goalkeeper ? p.white : skin, hand[0] - 1, hand[1] - 1, 3, 3);
  };
  arm(side > 0 ? 0 : 1);
  const lean = running ? side * 2 : 0;
  ctx.translate(lean, -bob);
  pixelPolygon(ctx, p.ink, [
    [-6, -39],
    [5, -39],
    [9, -35],
    [7, -24],
    [6, -20],
    [-6, -20],
    [-8, -27],
    [-9, -35],
  ]);
  pixelPolygon(ctx, kit, [
    [-5, -38],
    [4, -38],
    [8, -34],
    [6, -24],
    [-5, -24],
    [-7, -28],
    [-8, -34],
  ]);
  pixelPolygon(ctx, p.fabricShadow, [
    [-7, -34],
    [-4, -32],
    [-4, -25],
    [-6, -25],
  ]);
  pixelPolygon(ctx, p.fabricLight, [
    [2, -37],
    [5, -36],
    [6, -33],
    [4, -27],
    [3, -27],
  ]);
  rect(uniform.trim, -5, -25, 11, 1);
  pixelPolygon(ctx, p.ink, [
    [-6, -24],
    [7, -24],
    [8, -17],
    [2, -16],
    [0, -20],
    [-1, -16],
    [-7, -17],
  ]);
  pixelPolygon(ctx, uniform.shorts, [
    [-5, -23],
    [6, -23],
    [7, -18],
    [3, -17],
    [0, -22],
    [-2, -17],
    [-6, -18],
  ]);
  rect(kit, -5, -22, 1, 4);
  rect(uniform.trim, -6, -37, 3, 1);
  rect(uniform.trim, 4, -37, 3, 1);
  rect(p.ink, -2, -40, 5, 3);
  rect(skin, -1, -41, 3, 4);
  rect(uniform.trim, -2, -37, 5, 1);
  // Faceted head, ear and jaw: twelve native pixels instead of eighteen.
  pixelPolygon(ctx, p.ink, [
    [-4, -52],
    [4, -52],
    [6, -49],
    [6, -42],
    [3, -39],
    [-3, -40],
    [-5, -44],
    [-5, -49],
  ]);
  pixelPolygon(ctx, skin, [
    [-3, -50],
    [4, -50],
    [5, -47],
    [4, -42],
    [2, -40],
    [-2, -41],
    [-4, -44],
  ]);
  const hair = player.shirtNumber % 4 === 0 ? p.gold : p.hair;
  pixelPolygon(ctx, hair, [
    [-4, -51],
    [4, -51],
    [5, -48],
    [1, -49],
    [-2, -47],
    [-4, -46],
  ]);
  if (back) {
    rect(hair, -4, -48, 8, 6);
    rect(p.fabricLight, -3, -50, 5, 1);
  } else {
    rect(hair, -side * 3 - 1, -48, 2, 5);
    rect(p.ink, side > 0 ? 2 : -3, -46, 1, 2);
    rect(skin, side > 0 ? 5 : -5, -44, 2, 2);
    rect(p.fabricShadow, -2, -42, 5, 1);
    rect(p.fabricLight, side > 0 ? 3 : -3, -48, 1, 2);
  }
  if (showNumbers) shirtNumber(ctx, player.shirtNumber, -34, uniform.number);
  ctx.translate(-lean, bob);
  arm(side > 0 ? 1 : 0);
  if (selected) {
    rect(p.gold, -4, -61, 9, 2);
    rect(p.gold, -2, -59, 5, 2);
    rect(p.gold, 0, -57, 1, 1);
  }
  ctx.restore();
}
