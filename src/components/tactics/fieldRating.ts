import type { PlayerData, PlayerRole } from "../../store/types";
import { getRolesForPosition } from "../../lib/playerRoles";
import { canonicalPosition, normalisePosition } from "../squad/SquadTab.helpers";

type Attributes = PlayerData["attributes"];
type Attribute = keyof Attributes;
type RatingPlayer = Pick<
  PlayerData,
  | "attributes"
  | "natural_position"
  | "position"
  | "alternate_positions"
  | "footedness"
  | "weak_foot"
  | "ovr"
>;
type Weights = Partial<Record<Attribute, number>>;

// Mirror of ofm_core::player_rating::weighted_score. The stored OVR stays the
// natural-position baseline; only the difference between positions is applied.
const POSITION_WEIGHTS: Record<string, Weights> = {
  Goalkeeper: {
    handling: 25,
    reflexes: 24,
    positioning: 18,
    agility: 16,
    passing: 13,
    composure: 2,
    strength: 2,
  },
  RightBack: {
    pace: 18,
    stamina: 16,
    tackling: 17,
    defending: 16,
    positioning: 12,
    passing: 10,
    dribbling: 6,
    decisions: 5,
  },
  CenterBack: {
    defending: 20,
    tackling: 18,
    strength: 13,
    aerial: 12,
    pace: 12,
    positioning: 10,
    decisions: 7,
    composure: 5,
    aggression: 3,
  },
  RightWingBack: {
    pace: 18,
    stamina: 18,
    tackling: 14,
    defending: 12,
    passing: 13,
    dribbling: 11,
    vision: 7,
    decisions: 7,
  },
  DefensiveMidfielder: {
    tackling: 18,
    positioning: 18,
    decisions: 16,
    passing: 14,
    defending: 12,
    stamina: 10,
    vision: 7,
    strength: 5,
  },
  CentralMidfielder: {
    passing: 20,
    vision: 16,
    decisions: 16,
    stamina: 12,
    dribbling: 10,
    positioning: 9,
    teamwork: 9,
    tackling: 8,
  },
  AttackingMidfielder: {
    vision: 20,
    passing: 18,
    dribbling: 16,
    decisions: 14,
    shooting: 10,
    positioning: 8,
    composure: 8,
    pace: 6,
  },
  RightMidfielder: {
    pace: 17,
    stamina: 16,
    passing: 15,
    dribbling: 14,
    vision: 10,
    decisions: 10,
    positioning: 10,
    tackling: 8,
  },
  RightWinger: {
    pace: 22,
    dribbling: 22,
    passing: 14,
    shooting: 12,
    vision: 10,
    decisions: 8,
    positioning: 6,
    stamina: 6,
  },
  Striker: {
    shooting: 26,
    positioning: 18,
    decisions: 14,
    pace: 12,
    dribbling: 10,
    strength: 8,
    composure: 8,
    aerial: 4,
  },
};

const SAME_WEIGHTS: Record<string, string> = {
  LeftBack: "RightBack",
  LeftWingBack: "RightWingBack",
  LeftMidfielder: "RightMidfielder",
  LeftWinger: "RightWinger",
  Defender: "CenterBack",
  Midfielder: "CentralMidfielder",
  Forward: "Striker",
};

const CRITICAL: Record<string, Attribute[]> = {
  Goalkeeper: ["handling", "reflexes", "positioning"],
  RightBack: ["tackling", "defending", "positioning"],
  CenterBack: ["defending", "tackling", "positioning"],
  RightWingBack: ["pace", "stamina", "tackling"],
  DefensiveMidfielder: ["tackling", "positioning", "passing"],
  CentralMidfielder: ["passing", "vision", "decisions"],
  AttackingMidfielder: ["vision", "passing", "dribbling"],
  RightMidfielder: ["pace", "passing", "stamina"],
  RightWinger: ["pace", "dribbling", "passing"],
  Striker: ["shooting", "positioning", "decisions"],
};

const ROLE_ATTRIBUTES: Partial<Record<PlayerRole, Attribute[]>> = {
  BallPlayingKeeper: ["passing", "decisions", "composure"],
  SweeperKeeper: ["pace", "agility", "decisions"],
  Stopper: ["tackling", "strength", "aggression"],
  CoverCB: ["pace", "positioning", "decisions"],
  BallPlayingCB: ["passing", "vision", "composure"],
  AttackingFB: ["pace", "stamina", "dribbling", "passing"],
  DefensiveFB: ["tackling", "defending", "positioning", "strength"],
  InvertedFB: ["passing", "vision", "decisions"],
  WingBack: ["pace", "stamina", "dribbling", "tackling"],
  AnchorMan: ["tackling", "positioning", "strength"],
  BallWinner: ["tackling", "aggression", "stamina"],
  DeepLyingPlaymaker: ["passing", "vision", "decisions"],
  BoxToBox: ["stamina", "passing", "tackling"],
  Carrilero: ["stamina", "teamwork", "positioning"],
  Mezzala: ["dribbling", "vision", "passing"],
  AdvancedPlaymaker: ["vision", "passing", "decisions"],
  ShadowStriker: ["shooting", "positioning", "pace"],
  WideForward: ["pace", "dribbling", "shooting"],
  InsideForward: ["dribbling", "shooting", "decisions"],
  InvertedWinger: ["dribbling", "passing", "vision"],
  Poacher: ["shooting", "positioning", "composure"],
  TargetMan: ["strength", "aerial", "positioning"],
  DeepLyingForward: ["passing", "vision", "composure"],
  False9: ["passing", "vision", "dribbling"],
  PressingForward: ["stamina", "pace", "aggression"],
  CompleteForward: ["shooting", "passing", "dribbling", "strength"],
};

function ratingForPosition(attributes: Attributes, position: string): number {
  const key = SAME_WEIGHTS[position] ?? position;
  const weights = POSITION_WEIGHTS[key];
  if (!weights) return 0;
  const score =
    Object.entries(weights).reduce(
      (sum, [attribute, weight]) => sum + attributes[attribute as Attribute] * weight,
      0,
    ) / 100;
  const weakest = Math.min(...CRITICAL[key].map((attribute) => attributes[attribute]));
  return Math.max(1, Math.min(99, score - Math.max(0, 45 - weakest) * 0.6));
}

function footPenalty(player: RatingPlayer, slot: string): number {
  if (!player.footedness) return 0;
  const left = ["LeftBack", "LeftWingBack", "LeftMidfielder", "LeftWinger"].includes(slot);
  const right = ["RightBack", "RightWingBack", "RightMidfielder", "RightWinger"].includes(slot);
  if (
    (!left && !right) ||
    player.footedness === "Both" ||
    (left && player.footedness === "Left") ||
    (right && player.footedness === "Right")
  )
    return 0;
  return Math.max(0, 10 - Math.max(1, Math.min(5, player.weak_foot ?? 3)) * 2);
}

/** Estimate shown only for a player assigned to a pitch slot. */
export function getFieldRating(
  player: RatingPlayer,
  slotPosition: string,
  role: PlayerRole,
): number {
  const slot = canonicalPosition(slotPosition);
  const preferred = canonicalPosition(player.natural_position || player.position);
  const natural = canonicalPosition(
    ["Defender", "Midfielder", "Forward"].includes(preferred) ? player.position : preferred,
  );
  const slotScore = ratingForPosition(player.attributes, slot);
  const naturalScore = ratingForPosition(player.attributes, natural);
  if (slotScore === 0 || naturalScore === 0) return player.ovr ?? 0;

  const alternate = player.alternate_positions.some(
    (position) => canonicalPosition(position) === slot,
  );
  const compatibility =
    slot === natural
      ? 0
      : alternate
        ? 4
        : normalisePosition(slot) === normalisePosition(natural)
          ? 8
          : 14;
  const roleAttributes = getRolesForPosition(slot).includes(role)
    ? ROLE_ATTRIBUTES[role]
    : undefined;
  const roleScore = roleAttributes
    ? roleAttributes.reduce((sum, attribute) => sum + player.attributes[attribute], 0) /
      roleAttributes.length
    : slotScore;
  const roleAdjustment = roleAttributes
    ? Math.max(-6, Math.min(6, (roleScore - slotScore) * 0.25))
    : 0;
  return Math.max(
    1,
    Math.min(
      99,
      Math.round(
        (player.ovr ?? naturalScore) +
          slotScore -
          naturalScore -
          compatibility -
          footPenalty(player, slot) +
          roleAdjustment,
      ),
    ),
  );
}
