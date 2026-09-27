import { expect, it } from "vitest";
import { project, projectDirection, sortByDepth, viewport } from "./projection";

it("projects the entire field inside the viewport with two diagonal axes", () => {
  const corners = [
    [0, 0],
    [100, 0],
    [100, 68],
    [0, 68],
  ] as const;
  for (const [x, y] of corners) {
    const p = project(x, y);
    expect(p.x).toBeGreaterThan(60);
    expect(p.x).toBeLessThan(viewport.width - 60);
    expect(p.y).toBeGreaterThan(100);
    expect(p.y).toBeLessThan(viewport.height - 60);
  }
  expect(project(100, 0).y).toBeGreaterThan(project(0, 0).y);
  expect(project(0, 68).x).toBeLessThan(project(0, 0).x);
  expect(project(0, 68).y).toBeGreaterThan(project(0, 0).y);
});
it("preserves affine midpoints and lifts height vertically without moving the ground anchor", () => {
  const a = project(0, 0);
  const b = project(100, 68);
  expect(project(50, 34).x).toBeCloseTo((a.x + b.x) / 2);
  expect(project(50, 34).y).toBeCloseTo((a.y + b.y) / 2);
  expect(project(50, 34, 3).x).toBe(project(50, 34).x);
  expect(project(50, 34, 3).y).toBeLessThan(project(50, 34).y);
  expect(projectDirection(0).y).toBeGreaterThan(0);
  expect(projectDirection(Math.PI).x).toBeLessThan(0);
});
it("sorts by projected ground depth rather than match y, without mutating input", () => {
  const points = [
    { id: "near", x: 100, y: 0 },
    { id: "far", x: 0, y: 25 },
  ];
  expect(sortByDepth(points).map((p) => p.id)).toEqual(["far", "near"]);
  expect(points[0].id).toBe("near");
});
