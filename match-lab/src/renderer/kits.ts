import type { Team } from "../match/types";
import { palette as p } from "./palette";

export interface Kit {
  pattern: string;
  colors: { primary: string; secondary: string };
}
interface KitSource {
  colors?: Kit["colors"];
  kit_pattern?: string;
  kits?: { home?: Kit | null; away?: Kit | null };
}
export type MatchKits = Record<Team, Kit>;
const fallback: MatchKits = {
  home: { pattern: "Solid", colors: { primary: p.home, secondary: p.ink } },
  away: { pattern: "Solid", colors: { primary: p.away, secondary: p.white } },
};
function rgb(color: string): number[] {
  if (/^#[\da-f]{6}$/i.test(color))
    return [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  return color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
}
function brightness(color: string) {
  const [r, g, b] = rgb(color);
  return r * 0.299 + g * 0.587 + b * 0.114;
}
function difference(a: Kit, b: Kit) {
  const first = rgb(a.colors.primary);
  return Math.hypot(...rgb(b.colors.primary).map((v, i) => v - first[i]));
}
function normalize(kit: Kit | undefined | null, backup: Kit): Kit {
  const color = (value: string | undefined, fallback: string) =>
    value && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  return {
    pattern: kit?.pattern ?? "Solid",
    colors: {
      primary: color(kit?.colors.primary, backup.colors.primary),
      secondary: color(kit?.colors.secondary, backup.colors.secondary),
    },
  };
}
/** Presentation only: never changes the stored club identity. */
export function resolveMatchKits(home?: KitSource, away?: KitSource): MatchKits {
  const legacy = (team: KitSource | undefined) =>
    team?.colors ? { pattern: team.kit_pattern ?? "Solid", colors: team.colors } : undefined;
  const homeKit = normalize(home?.kits?.home ?? legacy(home), fallback.home);
  let awayKit = normalize(away?.kits?.away ?? legacy(away), fallback.away);
  if (difference(homeKit, awayKit) < 110) {
    const alternative = normalize(away?.kits?.home ?? legacy(away), fallback.away);
    awayKit =
      difference(homeKit, alternative) >= 110
        ? alternative
        : {
            pattern: "Solid",
            colors: {
              primary: brightness(homeKit.colors.primary) > 140 ? p.ink : p.white,
              secondary: awayKit.colors.secondary,
            },
          };
  }
  return { home: homeKit, away: awayKit };
}
/** Pattern dispatch stays here; unimplemented patterns deliberately render as Solid. */
export function spriteKit(kit: Kit) {
  switch (kit.pattern) {
    default: // Solid is the initial renderer; add explicit pattern cases here.
      return {
        shirt: kit.colors.primary,
        trim: kit.colors.secondary,
        shorts: kit.colors.secondary,
        socks: kit.colors.primary,
        number: brightness(kit.colors.primary) > 140 ? p.ink : p.white,
      };
  }
}
