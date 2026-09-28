import { expect, it } from "vitest";
import { resolveMatchKits, spriteKit } from "./kits";
const home = { pattern: "Solid", colors: { primary: "#FFFFFF", secondary: "#FEBE10" } };
const away = { pattern: "Solid", colors: { primary: "#0057B8", secondary: "#FFFFFF" } };
it("uses the home side's home kit and the visitor's away kit", () => {
  const kits = resolveMatchKits({ kits: { home, away } }, { kits: { home, away } });
  expect(kits.home).toEqual(home);
  expect(kits.away).toEqual(away);
  expect(spriteKit(kits.home)).toMatchObject({
    shirt: home.colors.primary,
    trim: home.colors.secondary,
    shorts: home.colors.secondary,
    socks: home.colors.primary,
  });
});
it("tries the visitor's home kit for a clash, then supplies a contrasting fallback", () => {
  expect(resolveMatchKits({ kits: { home } }, { kits: { home: away, away: home } }).away).toEqual(
    away,
  );
  const kits = resolveMatchKits({ kits: { home } }, { kits: { home, away: home } });
  expect(kits.away.colors.primary).not.toBe(home.colors.primary);
});
it("supports legacy colors and safely falls back for unsupported patterns or invalid colors", () => {
  expect(resolveMatchKits({ colors: home.colors }, undefined).home.colors).toEqual(home.colors);
  expect(spriteKit({ ...home, pattern: "Stripes" })).toEqual(spriteKit(home));
  expect(
    resolveMatchKits({ kits: { home: { ...home, colors: { primary: "broken", secondary: "" } } } })
      .home.colors.primary,
  ).not.toBe("broken");
  expect(spriteKit(away).number).not.toBe(spriteKit(home).number);
});
