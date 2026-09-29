import { useEffect, useRef } from "react";
import type { RenderSample } from "../match/types";
import { drawGoal, drawPitch } from "./pitchRenderer";
import { drawPlayer, PLAYER_SCALE } from "./playerRenderer";
import { drawBall } from "./ballRenderer";
import { drawForeground, drawStadium } from "./stadiumRenderer";
import { palette } from "./palette";
import { actionCamera } from "./actionCamera";
import { project, sortByDepth, viewport } from "./projection";
import { createSceneLayer } from "./sceneLayer";
import type { MatchKits } from "./kits";
export interface PlayerLabel {
  name?: string;
  rating?: number;
}
interface Props {
  sample: RenderSample;
  kits?: MatchKits;
  showNumbers: boolean;
  showCoordinates: boolean;
  label: string;
  goalLabel: string;
  showGoalBanner?: boolean;
  playerLabels?: ReadonlyMap<string, PlayerLabel>;
}
export function MatchCanvas({
  sample,
  kits,
  showNumbers,
  showCoordinates,
  label,
  goalLabel,
  showGoalBanner = true,
  playerLabels,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const background = useRef<HTMLCanvasElement | null>(null);
  const foreground = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const framing = actionCamera(sample.frame.ball, !showCoordinates && !reducedMotion);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    // Stadium, crowd and grass are rasterized once; only actors redraw during playback.
    background.current ??= createSceneLayer((context) => {
      drawStadium(context);
      drawPitch(context);
    });
    foreground.current ??= createSceneLayer(drawForeground);
    ctx.save();
    ctx.scale(1 / viewport.pixelScale, 1 / viewport.pixelScale);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(framing.x, framing.y);
    ctx.scale(framing.zoom, framing.zoom);
    ctx.drawImage(background.current, 0, 0, viewport.width, viewport.height);
    const { frame, event } = sample;
    if (showCoordinates) {
      ctx.strokeStyle = palette.net;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      const line = (ax: number, ay: number, bx: number, by: number) => {
        const a = project(ax, ay);
        const b = project(bx, by);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };
      for (let x = 0; x <= 100; x += 10) line(x, 0, x, 68);
      for (let y = 0; y <= 68; y += 10) line(0, y, 100, y);
      ctx.setLineDash([]);
    }
    // Goals share the same painter order as the upright player sprites.
    const actors = [
      ...frame.players.map((player) => ({
        x: player.x,
        y: player.y,
        draw: () =>
          drawPlayer(
            ctx,
            player,
            frame,
            frame.ball.ownerId === player.id,
            showNumbers,
            event,
            kits,
            reducedMotion,
          ),
      })),
      { x: 0, y: 34, draw: () => drawGoal(ctx, false) },
      { x: 100, y: 34, draw: () => drawGoal(ctx, true) },
    ];
    for (const actor of sortByDepth(actors)) actor.draw();
    ctx.drawImage(foreground.current, 0, 0, viewport.width, viewport.height);
    if (showCoordinates) {
      ctx.font = "12px monospace";
      for (const player of frame.players) {
        const s = project(player.x, player.y);
        ctx.fillStyle = palette.ink;
        ctx.fillRect(s.x - 31, s.y + 8, 66, 14);
        ctx.fillStyle = palette.white;
        ctx.fillText(`${player.x.toFixed(1)},${player.y.toFixed(1)}`, s.x - 29, s.y + 19);
      }
    }
    // Deliberate readability priority over sprites, nets, and debug labels.
    drawBall(ctx, frame.ball, frame.timeMs);
    ctx.restore(); // Keep overlays in screen space, independent of pitch framing.
    if (event?.kind === "goal") {
      const elapsed = reducedMotion ? 0 : (frame.timeMs - event.timeMs) / 1000;
      for (let i = 0; i < 42; i++) {
        ctx.fillStyle = i % 2 ? palette.home : palette.gold;
        ctx.fillRect(310 + ((i * 67) % 420), 10 + ((i * 29 + elapsed * 40) % 135), 4, 6);
      }
      if (showGoalBanner) {
        ctx.fillStyle = palette.ink;
        ctx.fillRect(390, 32, 340, 58);
        ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 2;
        ctx.strokeRect(390, 32, 340, 58);
        ctx.fillStyle = palette.white;
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillText(goalLabel.toUpperCase(), viewport.width / 2, 71, 310);
      }
    }
    ctx.restore();
  }, [
    kits,
    sample,
    showNumbers,
    showCoordinates,
    goalLabel,
    showGoalBanner,
    reducedMotion,
    framing.x,
    framing.y,
    framing.zoom,
  ]);
  return (
    <div className="relative overflow-hidden">
      <canvas
        ref={ref}
        width={viewport.width / viewport.pixelScale}
        height={viewport.height / viewport.pixelScale}
        aria-label={label}
        role="img"
        className="block h-auto w-full [image-rendering:pixelated]"
      >
        {label}
      </canvas>
      {sample.frame.players.map((player) => {
        const info = playerLabels?.get(player.id);
        if (!info) return null;
        const point = project(player.x, player.y);
        const left = `${((point.x * framing.zoom + framing.x) / viewport.width) * 100}%`;
        const top = (offset: number) =>
          `${(((point.y + offset) * framing.zoom + framing.y) / viewport.height) * 100}%`;
        return (
          <div key={player.id} className="pointer-events-none">
            {info.name && (
              <span
                title={info.name}
                className="pointer-events-auto absolute max-w-24 -translate-x-1/2 -translate-y-full truncate rounded bg-navy-900/90 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-white dark:bg-navy-900/90 dark:text-white sm:max-w-32 sm:text-xs"
                style={{ left, top: top(-70 * PLAYER_SCALE) }}
              >
                {info.name}
              </span>
            )}
            {info.rating !== undefined && (
              <span
                className="absolute -translate-x-1/2 rounded bg-navy-900/90 px-1.5 py-0.5 text-[10px] font-bold leading-tight text-white tabular-nums dark:bg-navy-900/90 dark:text-white sm:text-xs"
                style={{ left, top: top(8 * PLAYER_SCALE) }}
              >
                {info.rating.toFixed(1)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
