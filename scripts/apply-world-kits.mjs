import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { KIT_PATTERNS } from "./enrich-world-openai.mjs";

const color = /^#[0-9a-f]{6}$/i;

export function applyWorldKits(world, patch) {
  if (!Array.isArray(world?.teams) || !Array.isArray(patch?.teams)) {
    throw new Error("The world and patch each require a teams array");
  }
  const known = new Set(world.teams.map((team) => team.id));
  const updates = new Map();
  for (const row of patch.teams) {
    const id = row?.id;
    if (!known.has(id) || updates.has(id)) throw new Error(`Unknown or duplicate club ID: ${id}`);
    if (!row.kits || typeof row.kits !== "object" || Array.isArray(row.kits) ||
        Object.keys(row.kits).some((slot) => slot !== "home" && slot !== "away")) {
      throw new Error(`Invalid kits for ${id}`);
    }
    const kits = {};
    for (const slot of ["home", "away"]) {
      const kit = row.kits[slot];
      if (kit == null) continue;
      const { pattern, colors, unity_mask: mask } = kit;
      if (!KIT_PATTERNS.includes(pattern) ||
          typeof colors?.primary !== "string" || !color.test(colors.primary) ||
          typeof colors?.secondary !== "string" || !color.test(colors.secondary) ||
          (mask != null && (!Number.isInteger(mask) || mask < 1 || mask > 10))) {
        throw new Error(`Invalid ${slot} kit for ${id}`);
      }
      kits[slot] = { pattern, colors: { primary: colors.primary, secondary: colors.secondary } };
      if (mask != null) kits[slot].unity_mask = mask;
    }
    updates.set(id, kits);
  }
  return {
    ...world,
    teams: world.teams.map((team) => {
      const kits = updates.get(team.id);
      if (!kits || Object.keys(kits).length === 0) return team;
      const updated = { ...team, kits: { ...team.kits, ...kits } };
      if (kits.home) {
        updated.colors = kits.home.colors;
        updated.kit_pattern = kits.home.pattern;
      }
      return updated;
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [worldPath, patchPath, outputPath] = process.argv.slice(2);
    if (!worldPath || !patchPath || !outputPath) {
      throw new Error("Usage: node scripts/apply-world-kits.mjs world.json kits.json updated-world.json");
    }
    const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    const world = applyWorldKits(readJson(worldPath), readJson(patchPath));
    writeFileSync(outputPath, JSON.stringify(world, null, 2) + "\n", { flag: "wx" });
    console.log(outputPath);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
