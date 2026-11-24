import assert from "node:assert/strict";
import test from "node:test";
import { applyWorldKits } from "./apply-world-kits.mjs";

const home = { pattern: "Hoops", colors: { primary: "#112233", secondary: "#445566" }, unity_mask: 2 };
const away = { pattern: "Stripes", colors: { primary: "#FFFFFF", secondary: "#0055AA" }, unity_mask: 3 };
const world = {
  teams: [
    { id: "club-a", name: "Club A", kits: { home, away } },
    { id: "club-b", name: "Club B", kits: { home, away } },
  ],
  players: [{ id: "player-a" }],
};
const row = (kits) => ({ teams: [{ id: "club-b", kits }] });

test("merges slots by ID and keeps legacy home colors in sync", () => {
  const updated = applyWorldKits(world, row({ home: away, away: null }));
  assert.deepEqual(updated.teams[1], {
    ...world.teams[1],
    kits: { home: away, away },
    kit_pattern: away.pattern,
    colors: away.colors,
  });
  assert.deepEqual(updated.teams[0], world.teams[0]);
  assert.deepEqual(updated.players, world.players);
  assert.deepEqual(world.teams[1].kits, { home, away });
});

test("rejects invalid data before producing an updated world", () => {
  for (const patch of [
    row({ away: { ...away, unity_mask: 11 } }),
    row({ away: { ...away, pattern: "Pinstripes" } }),
    row({ away: { ...away, colors: { ...away.colors, primary: "white" } } }),
    { teams: [{ id: "wrong", kits: { away } }] },
    { teams: [...row({ away }).teams, ...row({ home }).teams] },
  ]) {
    assert.throws(() => applyWorldKits(world, patch));
  }
});
