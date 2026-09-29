import { expect, it, vi } from "vitest";
import { pixelPolygon, pixelLimb } from "./pixelFigure";
it("rasterizes sloped anatomy into whole pixel rows without filtered strokes", () => {
  const fillRect = vi.fn();
  const context = { fillStyle: "", fillRect } as unknown as CanvasRenderingContext2D;
  pixelPolygon(context, "white", [
    [0, 0],
    [5, 2],
    [3, 7],
    [-2, 3],
  ]);
  expect(fillRect).toHaveBeenCalled();
  for (const [x, y, width, height] of fillRect.mock.calls) {
    expect([x, y, width, height].every(Number.isInteger)).toBe(true);
    expect(width).toBeGreaterThan(0);
    expect(height).toBe(1);
  }
  fillRect.mockClear();
  pixelLimb(context, "white", [0, 0], [6, -8], 4);
  expect(fillRect).toHaveBeenCalled();
});
