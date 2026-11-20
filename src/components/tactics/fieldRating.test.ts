import { describe, expect, it } from "vitest";
import type { PlayerData } from "../../store/types";
import { getFieldRating } from "./fieldRating";

const attributes: PlayerData["attributes"] = {
  pace: 90,
  stamina: 85,
  strength: 70,
  agility: 70,
  passing: 78,
  shooting: 30,
  tackling: 55,
  dribbling: 85,
  defending: 55,
  positioning: 75,
  vision: 70,
  decisions: 75,
  composure: 70,
  aggression: 65,
  teamwork: 70,
  leadership: 60,
  handling: 10,
  reflexes: 10,
  aerial: 65,
};

const player: Pick<
  PlayerData,
  | "attributes"
  | "natural_position"
  | "position"
  | "alternate_positions"
  | "footedness"
  | "weak_foot"
  | "ovr"
> = {
  attributes,
  natural_position: "CenterBack",
  position: "Defender",
  alternate_positions: [],
  footedness: "Right",
  weak_foot: 3,
  ovr: 68,
};

describe("field rating", () => {
  it("keeps the base overall in a natural slot with the standard role", () => {
    expect(getFieldRating(player, "CenterBack", "Standard")).toBe(68);
  });

  it("reweights attributes when a center back moves to full back", () => {
    const fullBack = getFieldRating(player, "RightBack", "Standard");
    expect(fullBack).not.toBe(68);
    expect(fullBack).toBeGreaterThan(getFieldRating(player, "LeftBack", "Standard"));
  });

  it("rewards attacking full backs with an attacking profile and defensive full backs with a defensive profile", () => {
    expect(getFieldRating(player, "RightBack", "AttackingFB")).toBeGreaterThan(
      getFieldRating(player, "RightBack", "DefensiveFB"),
    );
    const defender = {
      ...player,
      attributes: { ...attributes, pace: 55, dribbling: 45, tackling: 90, defending: 90 },
    };
    expect(getFieldRating(defender, "RightBack", "DefensiveFB")).toBeGreaterThan(
      getFieldRating(defender, "RightBack", "AttackingFB"),
    );
  });

  it("recognizes alternate positions and clamps the displayed value", () => {
    const alternate = { ...player, alternate_positions: ["RightBack"] };
    expect(getFieldRating(alternate, "RightBack", "Standard")).toBeGreaterThan(
      getFieldRating(player, "RightBack", "Standard"),
    );
    expect(getFieldRating({ ...player, ovr: 99 }, "RightBack", "AttackingFB")).toBeLessThanOrEqual(
      99,
    );
  });

  it("ignores a stale role that is invalid for the assigned slot", () => {
    expect(getFieldRating(player, "RightBack", "Stopper")).toBe(
      getFieldRating(player, "RightBack", "Standard"),
    );
  });
});
