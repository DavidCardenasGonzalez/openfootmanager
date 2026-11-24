#!/usr/bin/env node
/**
 * Append one authored club, with its squad, to a runtime world database.
 *
 * The Top 5 importer only emits clubs from its five source leagues. A club from
 * anywhere else — a Sofia scrape, a hand-curated squad — is layered on top by
 * this script so rerunning `npm run import:top5` does not have to know about it.
 * The patch file carries runtime-shaped team and player records (see
 * `data/sofifa-source/tigres-uanl.json`); this script validates them and
 * appends without touching the rest of the world.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const POSITIONS = new Set([
  "Goalkeeper",
  "Defender",
  "Midfielder",
  "Forward",
  "RightBack",
  "CenterBack",
  "LeftBack",
  "RightWingBack",
  "LeftWingBack",
  "DefensiveMidfielder",
  "CentralMidfielder",
  "AttackingMidfielder",
  "RightMidfielder",
  "LeftMidfielder",
  "RightWinger",
  "LeftWinger",
  "Striker",
]);

const ATTRIBUTES = [
  "pace",
  "stamina",
  "strength",
  "agility",
  "passing",
  "shooting",
  "tackling",
  "dribbling",
  "defending",
  "positioning",
  "vision",
  "decisions",
  "composure",
  "aggression",
  "teamwork",
  "leadership",
  "handling",
  "reflexes",
  "aerial",
];

const text = (value) => typeof value === "string" && value.trim().length > 0;
const rating = (value) => Number.isInteger(value) && value >= 0 && value <= 99;

function assertTeam(team, knownTeamIds) {
  if (!team || typeof team !== "object") throw new Error("The patch requires a team object");
  if (!text(team.id)) throw new Error("The patch team is missing an id");
  if (knownTeamIds.has(team.id)) throw new Error(`Team already exists: ${team.id}`);
  for (const field of ["name", "country", "city", "stadium_name", "formation"]) {
    if (!text(team[field])) throw new Error(`Team ${team.id} is missing ${field}`);
  }
  if (!text(team.colors?.primary) || !text(team.colors?.secondary)) {
    throw new Error(`Team ${team.id} is missing colors`);
  }
  if (!Number.isInteger(team.reputation) || team.reputation < 0) {
    throw new Error(`Team ${team.id} needs a non-negative reputation`);
  }
}

function assertPlayer(player, teamId, knownPlayerIds) {
  if (!player || typeof player !== "object") throw new Error("The patch requires player objects");
  if (!text(player.id)) throw new Error("A patch player is missing an id");
  if (knownPlayerIds.has(player.id)) throw new Error(`Player already exists: ${player.id}`);
  if (player.team_id !== teamId) {
    throw new Error(`Player ${player.id} points at ${player.team_id}, not ${teamId}`);
  }
  if (!text(player.full_name) || !text(player.match_name)) {
    throw new Error(`Player ${player.id} is missing a name`);
  }
  if (!POSITIONS.has(player.position) || !POSITIONS.has(player.natural_position)) {
    throw new Error(`Player ${player.id} has an unknown position`);
  }
  if (!ATTRIBUTES.every((key) => rating(player.attributes?.[key]))) {
    throw new Error(`Player ${player.id} has missing or out-of-range attributes`);
  }
  if (!rating(player.potential)) {
    throw new Error(`Player ${player.id} needs a potential between 0 and 99`);
  }
}

export function addWorldTeam(world, patch) {
  if (!Array.isArray(world?.teams) || !Array.isArray(world?.players)) {
    throw new Error("The world requires teams and players arrays");
  }
  const team = patch?.team;
  assertTeam(team, new Set(world.teams.map((entry) => entry.id)));

  const existingPlayerIds = new Set(world.players.map((entry) => entry.id));
  const additions = patch.players;
  if (!Array.isArray(additions) || additions.length === 0) {
    throw new Error(`Team ${team.id} has no players`);
  }
  const seen = new Set(existingPlayerIds);
  const shirtNumbers = new Set();
  for (const player of additions) {
    assertPlayer(player, team.id, seen);
    seen.add(player.id);
    // players has a UNIQUE (team_id, jersey_number) index; null is exempt.
    if (player.jersey_number != null) {
      if (shirtNumbers.has(player.jersey_number)) {
        throw new Error(`Team ${team.id} repeats shirt number ${player.jersey_number}`);
      }
      shirtNumbers.add(player.jersey_number);
    }
  }

  return {
    ...world,
    teams: [...world.teams, team],
    players: [...world.players, ...additions],
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [worldPath, patchPath, outputPath] = process.argv.slice(2);
    if (!worldPath || !patchPath || !outputPath) {
      throw new Error(
        "Usage: node scripts/add-world-team.mjs world.json team.json updated-world.json",
      );
    }
    const world = addWorldTeam(readJson(worldPath), readJson(patchPath));
    // `wx` keeps a typo in the output path from destroying a world database.
    writeFileSync(outputPath, `${JSON.stringify(world, null, 2)}\n`, { flag: "wx" });
    console.log(`${outputPath}: ${world.teams.length} teams, ${world.players.length} players`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
