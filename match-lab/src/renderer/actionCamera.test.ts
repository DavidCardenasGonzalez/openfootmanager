import { describe, expect, it } from "vitest";
import { actionCamera } from "./actionCamera";
import { project, viewport } from "./projection";

describe("action framing", () => {
  it("keeps the ball on screen and never reveals blank canvas at either goal or touchline", () => {
    for (const x of [-2, 0, 50, 100, 102])
      for (const y of [0, 34, 68]) {
        const camera = actionCamera({ x, y });
        const ball = project(x, y);
        expect(ball.x * camera.zoom + camera.x).toBeGreaterThan(16);
        expect(ball.x * camera.zoom + camera.x).toBeLessThan(viewport.width - 16);
        expect(ball.y * camera.zoom + camera.y).toBeGreaterThan(16);
        expect(ball.y * camera.zoom + camera.y).toBeLessThan(viewport.height - 16);
        expect(camera.x).toBeLessThanOrEqual(0);
        expect(camera.y).toBeLessThanOrEqual(0);
        expect(camera.x + viewport.width * camera.zoom).toBeGreaterThanOrEqual(viewport.width);
        expect(camera.y + viewport.height * camera.zoom).toBeGreaterThanOrEqual(viewport.height);
      }
  });
  it("is seek-stable, pans gently and disables movement for debug or reduced motion", () => {
    const a = actionCamera({ x: 50, y: 34 });
    const b = actionCamera({ x: 51, y: 34 });
    expect(Math.abs(a.x - b.x)).toBeLessThan(4);
    expect(actionCamera({ x: 50, y: 34 })).toEqual(a);
    expect(actionCamera({ x: 90, y: 20 }, false)).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
