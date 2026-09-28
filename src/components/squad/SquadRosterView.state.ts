export type SquadListSortKey =
  | "jersey"
  | "name"
  | "pos"
  | "fit"
  | "style"
  | "age"
  | "condition"
  | "morale"
  | "ovr"
  | "contract"
  | "appearances"
  | "goals"
  | "assists"
  | "yellow_cards"
  | "red_cards"
  | "avg_rating"
  | "wage"
  | "market_value";

export type SquadRosterViewMode = "general" | "statistics" | "finances";

export const SQUAD_VIEW_COLUMNS: Record<
  SquadRosterViewMode,
  { key: SquadListSortKey; labelKey: string }[]
> = {
  general: [
    { key: "pos", labelKey: "squad.pos" },
    { key: "style", labelKey: "tactics.playStyle" },
    { key: "condition", labelKey: "common.condition" },
    { key: "ovr", labelKey: "common.ovr" },
  ],
  statistics: [
    { key: "appearances", labelKey: "playerProfile.apps" },
    { key: "goals", labelKey: "playerProfile.goals" },
    { key: "assists", labelKey: "playerProfile.assists" },
    { key: "yellow_cards", labelKey: "playerProfile.yellows" },
  ],
  finances: [
    { key: "wage", labelKey: "finances.wagePerWeek" },
    { key: "market_value", labelKey: "finances.marketValue" },
    { key: "contract", labelKey: "common.contract" },
  ],
};

export interface SquadListSortState {
  sortKey: SquadListSortKey;
  sortDir: "asc" | "desc";
}

/**
 * Default: sort by position — starters first (XI members top), then by
 * natural_position in football-canonical order (GK → back line → midfield →
 * forwards), then by OVR desc so the strongest at each slot rises within its
 * cluster. This gives a "who plays where" view at a glance without the user
 * having to touch the sort headers.
 */
export const DEFAULT_SQUAD_LIST_SORT_STATE: SquadListSortState = {
  sortKey: "pos",
  sortDir: "asc",
};
