import { readFileSync } from "node:fs";
import { resolveMatchKits, type Kit } from "./src/renderer/kits";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Ship only the two demo kits, not the full world/player database, to the browser.
const world: { teams: { kits?: { home?: Kit; away?: Kit } }[] } = JSON.parse(
  readFileSync(new URL("../data/open-manager/world.json", import.meta.url), "utf8"),
);
export default defineConfig({
  define: { __MATCH_LAB_KITS__: JSON.stringify(resolveMatchKits(world.teams[0], world.teams[1])) },
  plugins: [react(), tailwindcss()],
  base: "./",
  server: { port: 5174, strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
