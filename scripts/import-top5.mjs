#!/usr/bin/env node
/**
 * Convert the Top 5 Sofascore/DataFC JSON export into the runtime Open Manager world database.
 *
 * The exporter has changed field names between snapshots, so this importer
 * deliberately reads by stable ids first and keeps a small alias table for
 * the fields we actually use. It never uses array order for an entity id.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const rawDir = path.resolve(process.argv[2] ?? "data/top5-source/raw");
const outDir = path.resolve(process.argv[3] ?? "data/open-manager");
const outFile = path.join(outDir, "world.json");
const TARGETS = new Map([
  ["england", "EN"], ["eng", "EN"], ["premier league", "EN"],
  ["spain", "ES"], ["esp", "ES"], ["laliga", "ES"], ["la liga", "ES"],
  ["italy", "IT"], ["ita", "IT"], ["serie a", "IT"],
  ["germany", "DE"], ["ger", "DE"], ["bundesliga", "DE"],
  ["france", "FR"], ["fra", "FR"], ["ligue 1", "FR"],
]);

const asArray = (value) => Array.isArray(value) ? value : [];
const first = (obj, keys, fallback = undefined) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
};
const text = (obj, keys, fallback = "") => String(first(obj, keys, fallback) ?? fallback).trim();
const number = (obj, keys, fallback = 0) => {
  const value = Number(first(obj, keys, fallback));
  return Number.isFinite(value) ? value : fallback;
};
const normalise = (value) => String(value ?? "").trim().toLowerCase().replace(/[–—]/g, "-");
const optionalText = (obj, keys) => {
  const value = first(obj, keys);
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") return String(value.name ?? value.label ?? value.id ?? JSON.stringify(value));
  return String(value);
};
const optionalNumber = (obj, keys) => {
  const value = first(obj, keys);
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const sourceId = (value, kind) => {
  const id = first(value, ["id", "uid", "uuid", `${kind}Id`, "source_id", "sourceId"]);
  return id === undefined || id === null || id === "" ? null : String(id);
};
const stableId = (kind, id) => `top5-${kind}-${String(id).replace(/[^a-zA-Z0-9_-]+/g, "-")}`;

function readJson(name, required = false) {
  const file = path.join(rawDir, name);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing required Top 5 source file: ${file}`);
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  return first(parsed, ["items", "data", "records", name.replace(/\.json$/, "")], []);
}

function competitionCountry(competition) {
  const raw = normalise(first(competition, ["country", "countryName", "nation", "country_code", "countryCode"]));
  const name = normalise(first(competition, ["name", "competitionName", "shortName"]));
  for (const [needle, code] of TARGETS) if (raw === needle || name.includes(needle)) return code;
  return null;
}

function position(value) {
  const key = normalise(value);
  if (key.includes("keeper") || key === "gk" || key === "goalkeeper" || key === "g") return "Goalkeeper";
  if (key.includes("right back") || key === "rb" || key === "rwb") return "RightBack";
  if (key.includes("left back") || key === "lb" || key === "lwb") return "LeftBack";
  if (key.includes("centre back") || key.includes("center back") || key === "cb") return "CenterBack";
  if (key.includes("defender") || key === "df" || key === "def" || key === "d") return "Defender";
  if (key.includes("wing") && key.includes("right")) return "RightWinger";
  if (key.includes("wing") && key.includes("left")) return "LeftWinger";
  if (key.includes("defensive mid") || key === "dm") return "DefensiveMidfielder";
  if (key.includes("attacking mid") || key === "am") return "AttackingMidfielder";
  if (key.includes("central mid") || key === "cm") return "CentralMidfielder";
  if (key.includes("mid") || key === "mf" || key === "m") return "Midfielder";
  if (key.includes("striker") || key.includes("forward") || key === "st" || key === "f") return "Striker";
  return null;
}

const attrs = (raw) => ({
  pace: number(raw, ["pace", "speed"], 50), stamina: number(raw, ["stamina", "endurance"], 50),
  strength: number(raw, ["strength", "physicalStrength"], 50), agility: number(raw, ["agility"], 50),
  passing: number(raw, ["passing", "passingTechnique"], 50), shooting: number(raw, ["shooting", "finishing"], 50),
  tackling: number(raw, ["tackling"], 50), dribbling: number(raw, ["dribbling"], 50), defending: number(raw, ["defending", "marking"], 50),
  positioning: number(raw, ["positioning"], 50), vision: number(raw, ["vision"], 50), decisions: number(raw, ["decisions"], 50),
  composure: number(raw, ["composure"], 50), aggression: number(raw, ["aggression"], 50), teamwork: number(raw, ["teamwork"], 50), leadership: number(raw, ["leadership"], 50),
  handling: number(raw, ["handling", "goalkeepingHandling"], 50), reflexes: number(raw, ["reflexes", "goalkeepingReflexes"], 50), aerial: number(raw, ["aerial", "aerialAbility"], 50),
});

function runtimePlayer(raw, clubId, warnings) {
  const sid = sourceId(raw, "player");
  if (!sid) throw new Error("Player is missing a stable source id");
  const source = { ...(raw.sourceData ?? {}), ...raw };
  const fullName = text(source, ["fullName", "name", "displayName"]);
  const natural = position(first(source, ["position", "primaryPosition", "mainPosition", "role"]));
  if (!natural) warnings.push(`Player ${sid} has no recognised position`);
  const age = optionalNumber(source, ["age"]);
  const dob = text(
    source,
    ["dateOfBirth", "date_of_birth", "dob", "birthDate"],
    age === undefined ? "2000-01-01" : `${new Date().getUTCFullYear() - Math.round(age)}-07-01`,
  );
  const appearance = { ...(source.appearance ?? {}), ...(source.physicalProfile ?? {}), ...source };
  const p = {
    id: stableId("player", sid), match_name: text(source, ["shortName", "short_name"], fullName), full_name: fullName, date_of_birth: dob,
    nationality: text(source, ["nationality", "nation", "nationalityName"], "UN"), football_nation: text(source, ["nationality", "nation"], "UN"),
    birth_country: first(source, ["birthCountry", "birth_country"], null), media: {
      source_age: age,
      source_data: source,
      skin_tone: optionalText(appearance, ["skinTone", "skin_tone"]),
      hair_color: optionalText(appearance, ["hairColor", "hair_color"]),
      hair_length: optionalText(appearance, ["hairLength", "hair_length"]),
      height: optionalNumber(appearance, ["height", "heightCm", "height_cm"]),
      weight: optionalNumber(appearance, ["weight", "weightKg", "weight_kg"]),
    }, position: natural ?? "Midfielder", natural_position: natural ?? "Midfielder", alternate_positions: [], footedness: normalise(text(source, ["preferredFoot", "foot"], "Right")) === "left" ? "Left" : "Right", weak_foot: 2,
    attributes: attrs({ ...source, ...(source.attributes ?? {}), ...(source.technical ?? {}), ...(source.mental ?? {}), ...(source.physical ?? {}), ...(source.goalkeeping ?? {}) }),
    condition: 100, morale: 75, fitness: 75, injury: null, team_id: clubId, retired: false, squad_role: "Senior", traits: [],
    ovr: Math.max(1, Math.min(99, number(source, ["currentAbility", "current_ability", "ca", "ovr"], 50))),
    potential: Math.max(1, Math.min(99, number(source, ["potentialAbility", "potential_ability", "pa", "potential"], 50))),
    contract_end: first(source, ["contractEnd", "contract_end", "contractUntil"], null), wage: number(source, ["wage", "weeklyWage", "salary"], 0), market_value: number(source, ["value", "marketValue", "market_value"], 0),
stats: { appearances: 0, goals: 0, assists: 0, clean_sheets: 0, yellow_cards: 0, red_cards: 0, avg_rating: 0, minutes_played: 0, shots: 0, shots_on_target: 0, passes_completed: 0, passes_attempted: 0, tackles_won: 0, interceptions: 0, fouls_committed: 0 },
    career: [], movement_history: [], training_focus: null, transfer_listed: false, loan_listed: false, transfer_offers: [], loan_offers: [], active_loan: null, morale_core: {}, jersey_number: null,
  };
  if (!fullName) throw new Error(`Player ${sid} is missing a name`);
  return p;
}

function runtimeTeam(raw, sid, country, reputation) {
  const source = { ...(raw.sourceData ?? {}), ...raw };
  const name = text(source, ["name", "clubName", "fullName"]);
  if (!name) throw new Error(`Club ${sid} is missing a name`);
  return { id: stableId("club", sid), name, short_name: text(source, ["shortName", "abbreviation"], name.slice(0, 3).toUpperCase()), country, football_nation: country, city: text(source, ["city", "town"], name), stadium_name: text(source, ["stadium", "stadiumName"], `${name} Stadium`), stadium_capacity: number(source, ["stadiumCapacity", "capacity"], 10000), finance: number(source, ["finance", "balance"], 1000000), manager_id: null, reputation, wage_budget: 0, transfer_budget: 0, season_income: 0, season_expenses: 0, financial_ledger: [], sponsorship: null, facilities: { training: 5, medical: 5, scouting: 5 }, formation: "4-4-2", play_style: "Balanced", player_roles: {}, tactics_phase: {}, training_focus: "Tactical", training_intensity: "Medium", training_schedule: "Balanced", founded_year: number(source, ["founded", "foundedYear"], 1900), colors: { primary: "#1f2937", secondary: "#ffffff" }, kit_pattern: "Solid", media: {}, training_groups: [], starting_xi_ids: [], match_roles: {}, form: [], history: [] };
}

function build() {
  if (!fs.existsSync(rawDir)) {
    throw new Error(
      `Top 5 source directory not found: ${rawDir}. Run ` +
        `scripts/build-open-manager-top5-2026-27.py first`,
    );
  }
  const sourceClubs = readJson("clubs.json", true);
  const sourcePlayers = readJson("players.json", true);
  const sourceCompetitions = readJson("competitions.json", true);
  const sourceContracts = readJson("contracts.json");
  const warnings = [];
  const targetCompetitions = sourceCompetitions.filter((c) => competitionCountry(c));
  const targetCompetitionIds = new Set(targetCompetitions.map((c) => sourceId(c, "competition")).filter(Boolean));
  const targetCompetitionNames = new Set(targetCompetitions.map((c) => normalise(c.name)));
  const countryByCompetition = new Map(targetCompetitions.map((c) => [sourceId(c, "competition"), competitionCountry(c)]));
  const clubsById = new Map();
  const teams = [];
  const leagueByClub = new Map();
  for (const raw of sourceClubs) {
    const sid = sourceId(raw, "club");
    const competitionId = first(raw, ["competitionId", "competition_id"]);
    const competitionName = normalise(first(raw, ["competitionName", "competition_name"]));
    if (!sid || !(targetCompetitionIds.has(String(competitionId)) || targetCompetitionNames.has(competitionName))) continue;
    if (clubsById.has(sid)) throw new Error(`Duplicate club source id: ${sid}`);
    const country = countryByCompetition.get(String(competitionId)) ?? competitionCountry({ name: competitionName }) ?? text(raw, ["countryCode", "country", "nation"], "UN").toUpperCase();
    const reputation = number(raw, ["reputation", "ranking", "clubReputation"], 0);
    const team = runtimeTeam(raw, sid, country, reputation);
    clubsById.set(sid, team.id); clubsById.set(String(raw.id ?? sid), team.id); leagueByClub.set(team.id, text(raw, ["competitionName", "competition_name"], "Unknown")); teams.push(team);
  }
  if (teams.length === 0) throw new Error("No clubs from the five target competitions were mapped");
  const players = [];
  const playerIds = new Set();
  const sourceClubForPlayer = new Map();
  for (const raw of sourcePlayers) {
    const sid = sourceId(raw, "player");
    const source = { ...(raw.sourceData ?? {}), ...raw };
    const sourceClub = first(source, ["clubId", "teamId", "currentClubId", "club_id"]);
    const runtimeClub = clubsById.get(String(sourceClub));
    if (!sid || !runtimeClub) continue;
    const player = runtimePlayer(raw, runtimeClub, warnings);
    if (playerIds.has(player.id)) throw new Error(`Duplicate player source id: ${sid}`);
    playerIds.add(player.id); sourceClubForPlayer.set(player.id, runtimeClub); players.push(player);
  }
  for (const contract of sourceContracts) {
    const player = players.find((candidate) => candidate.id === stableId("player", String(first(contract, ["playerId", "player_id"] ?? ""))));
    if (player) { player.wage = number(contract, ["wage", "weeklyWage", "salary"], player.wage); player.contract_end = first(contract, ["endDate", "contractEnd", "contract_end"], player.contract_end); }
  }
  const clubCounts = new Map(teams.map((team) => [team.id, 0]));
  for (const player of players) clubCounts.set(player.team_id, (clubCounts.get(player.team_id) ?? 0) + 1);
  const marketValueByClub = new Map(teams.map((team) => [team.id, 0]));
  for (const player of players) marketValueByClub.set(player.team_id, (marketValueByClub.get(player.team_id) ?? 0) + player.market_value);
  const ranking = [...teams].sort((a, b) => (marketValueByClub.get(b.id) ?? 0) - (marketValueByClub.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  ranking.forEach((team, index) => { team.reputation = ranking.length - index; });
  const divisions = [];
  for (let i = 0; i < ranking.length; i += 20) divisions.push(ranking.slice(i, i + 20));
  const duplicateNames = [...new Set(players.map((p) => p.full_name))].filter((name) => players.filter((p) => p.full_name === name).length > 1);
  const clubsPerSourceLeague = Object.fromEntries([...new Set(teams.map((team) => leagueByClub.get(team.id) ?? "Unknown"))].sort().map((league) => [league, teams.filter((team) => leagueByClub.get(team.id) === league).length]));
  const playersPerClub = Object.fromEntries(teams.map((team) => [team.name, clubCounts.get(team.id) ?? 0]));
  const report = { sourceCompetitions: targetCompetitions.length, sourceClubs: sourceClubs.length, clubsImported: teams.length, clubsPerSourceLeague, playersImported: players.length, playersPerClub, playersWithAppearance: players.filter((p) => Object.values(p.media).some((value) => value !== undefined)).length, physicalMetadata: { height: players.filter((p) => p.media.height !== undefined).length, weight: players.filter((p) => p.media.weight !== undefined).length, age: players.filter((p) => p.media.source_age !== undefined).length }, divisions: divisions.map((d, i) => ({ division: i + 1, clubs: d.length })), playersWithoutClub: sourcePlayers.filter((raw) => !clubsById.has(String(first(raw, ["clubId", "teamId", "currentClubId", "club_id"])))).length, clubsWithoutSquad: teams.filter((t) => !clubCounts.get(t.id)).length, duplicateClubIds: 0, duplicatePlayerIds: 0, duplicateNames, playersWithoutPositions: warnings.filter((warning) => warning.includes("no recognised position")), unmappedClubs: sourceClubs.filter((raw) => !clubsById.has(String(sourceId(raw, "club")))).map((raw) => raw.name), unmappedTargetCompetitions: sourceCompetitions.filter((c) => !competitionCountry(c)).map((c) => c.name), warnings };
  const world = { name: "Open Manager", description: "Imported Top 5 2026/27 squads for the unified Open Manager pyramid", teams, players, staff: [], managers: [], competitions: [], national_teams: [], regions: [], default_active_regions: ["europe"], default_active_competitions: [], league: null, news: [], stats: { player_matches: [], team_matches: [] }, world_history: {}, metadata: { format_version: 1, world_id: "open-manager-top5-2026-27", kind: "rosterBaseline", base_year: new Date().getUTCFullYear() }, extra_translations: {} };
  fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(outFile, `${JSON.stringify(world, null, 2)}\n`); fs.writeFileSync(path.join(outDir, "import-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log("Open Manager world generated\n"); console.log(`Source competitions: ${report.sourceCompetitions}`); console.log(`Clubs imported: ${report.clubsImported}`); console.log(`Players imported: ${report.playersImported}`); console.log(`Players with appearance metadata: ${report.playersWithAppearance}`); report.divisions.forEach((d) => console.log(`Division ${d.division}: ${d.clubs} clubs`)); console.log(`Players without club: ${report.playersWithoutClub}`); console.log(`Clubs without squad: ${report.clubsWithoutSquad}`); console.log(`Validation errors: 0`); console.log(`Warnings: ${warnings.length}`); console.log("\nOrdered club list:"); divisions.forEach((d, i) => console.log(`Division ${i + 1}: ${d.map((t) => t.name).join(", ")}`));
}

try { build(); } catch (error) { console.error(`Top 5 import failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
