import { expect, it } from "vitest";
import { createDemoReplay } from "./demoReplay";
const replay = createDemoReplay();
const frame = (time: number) => {
  const result = replay.frames.find((f) => f.timeMs === time);
  if (!result) throw new Error("Missing fixture frame");
  return result;
};
const player = (time: number, id: string) => {
  const result = frame(time).players.find((p) => p.id === id);
  if (!result) throw new Error("Missing fixture player");
  return result;
};
it("shows two controlled receptions, deliberate releases, and a shot wind-up", () => {
  expect(frame(20000).ball.ownerId).toBe("h7");
  expect(frame(20300).ball.motion).toBe("pass");
  expect(frame(21100).ball.ownerId).toBe("h10");
  expect(player(21100, "h10").action).toBe("idle");
  expect(frame(22400).ball.motion).toBe("pass");
  expect(frame(23300).ball.ownerId).toBe("h9");
  expect(frame(24000).ball.ownerId).toBe("h9");
  expect(player(24000, "h9").action).toBe("shoot");
  expect(frame(24400).ball.motion).toBe("shot");
  expect(frame(24400).ball.ownerId).toBeUndefined();
});
it("curves the striker run and brakes before receiving instead of gliding at constant speed", () => {
  expect(player(21700, "h9").y).toBeGreaterThan(player(20000, "h9").y);
  const speed = (t: number) =>
    Math.hypot(
      player(t + 100, "h9").x - player(t, "h9").x,
      player(t + 100, "h9").y - player(t, "h9").y,
    );
  expect(speed(20000)).toBeLessThan(speed(21500));
  expect(speed(23200)).toBeLessThan(speed(21500));
});
it("keeps the keeper set until the shot, then reacts toward the target corner", () => {
  expect(player(24400, "a1").y).toBe(player(24000, "a1").y);
  expect(player(24900, "a1").y).toBeLessThan(player(24500, "a1").y);
  expect(frame(24900).ball.x).toBeLessThan(100);
  expect(frame(25000).ball.x).toBeGreaterThan(100);
  expect(frame(25000).score.home).toBe(1);
});

it('plays both passes through clear lanes rather than through a defender', () => {
  for (const f of replay.frames.filter(f => f.timeMs >= 20000 && f.timeMs < 24000 && f.ball.motion === 'pass')) {
    const nearest = Math.min(...f.players.filter(p => p.team === 'away').map(p => Math.hypot(p.x - f.ball.x, p.y - f.ball.y)));
    expect(nearest).toBeGreaterThan(2);
  }
});
