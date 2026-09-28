import { viewport } from "./projection";

/** Rasterize original geometry at 2×, rather than magnifying a low-resolution bitmap.
 * This covers the 1.85× broadcast zoom; cached layers keep the per-frame cost bounded. */
export function createSceneLayer(draw: (context: CanvasRenderingContext2D) => void) {
  const density = 2;
  const layer = document.createElement("canvas");
  layer.width = viewport.width * density;
  layer.height = viewport.height * density;
  const context = layer.getContext("2d");
  if (context) {
    context.imageSmoothingEnabled = false;
    context.scale(density, density);
    draw(context);
  }
  return layer;
}
