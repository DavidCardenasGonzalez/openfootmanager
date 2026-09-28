import { afterEach, expect, it, vi } from "vitest";
import { createSceneLayer } from "./sceneLayer";
import { viewport } from "./projection";

afterEach(() => vi.unstubAllGlobals());
it("renders at native match resolution rather than enlarging a half-size framebuffer", () => {
  expect(viewport.width / viewport.pixelScale).toBeGreaterThanOrEqual(1120);
  expect(viewport.height / viewport.pixelScale).toBeGreaterThanOrEqual(800);
});
it("rasterizes static geometry at enough resolution for the broadcast zoom", () => {
  const context = { scale: vi.fn(), imageSmoothingEnabled: true };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  const draw = vi.fn();
  const layer = createSceneLayer(draw);
  expect(layer.width).toBe(2240);
  expect(layer.height).toBe(1600);
  expect(context.scale).toHaveBeenCalledWith(2, 2);
  expect(context.imageSmoothingEnabled).toBe(false);
  expect(draw).toHaveBeenCalledWith(context);
});
