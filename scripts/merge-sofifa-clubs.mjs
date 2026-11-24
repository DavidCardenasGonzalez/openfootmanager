#!/usr/bin/env node
/**
 * Merge every SofIFA club snapshot in data/sofifa-source/ into the runtime world,
 * then recompute each club's reputation from its squad market value so the new
 * clubs land in the right division of the unified pyramid.
 *
 * Usage: node scripts/merge-sofifa-clubs.mjs [world.json] [sourceDir]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addWorldTeam } from "./add-world-team.mjs";

const worldPath = process.argv[2] ?? "data/open-manager/world.json";
const sourceDir = process.argv[3] ?? "data/sofifa-source";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));

const world = readJson(worldPath);
const knownTeamIds = new Set(world.teams.map((t) => t.id));
const patches = readdirSync(sourceDir)
  .filter((name) => /^sofifa-club-\d+\.json$/.test(name))
  .map((name) => readJson(join(sourceDir, name)))
  .sort((a, b) => a.team.id.localeCompare(b.team.id));

let merged = world;
let added = 0;
for (const patch of patches) {
  if (knownTeamIds.has(patch.team.id)) continue;
  merged = addWorldTeam(merged, patch);
  knownTeamIds.add(patch.team.id);
  added += 1;
}

// Reputation = rank by total squad market value, matching scripts/import-top5.mjs.
const squadValue = new Map(merged.teams.map((t) => [t.id, 0]));
for (const p of merged.players) {
  squadValue.set(p.team_id, (squadValue.get(p.team_id) ?? 0) + (p.market_value ?? 0));
}
const ranking = [...merged.teams].sort(
  (a, b) =>
    (squadValue.get(b.id) ?? 0) - (squadValue.get(a.id) ?? 0) ||
    a.id.localeCompare(b.id),
);
ranking.forEach((team, index) => {
  team.reputation = ranking.length - index;
});

const outPath = worldPath.replace(/\.json$/, ".merged.json");
writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`added ${added} clubs; ${merged.teams.length} teams, ${merged.players.length} players`);
console.log(`wrote ${outPath}`);
