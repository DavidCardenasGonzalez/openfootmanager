import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  GameStateData,
  PlayerData,
  PlayerSelectionOptions,
  TeamData,
} from "../../store/gameStore";
import { Badge, Card, Select, CountryFlag, PlayerAvatar, InjuryBadge } from "../ui";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Repeat,
  RotateCcw,
  TimerOff,
  Trash2,
  Users,
} from "lucide-react";
import {
  getPlayerOvr,
  getPlayerDisplayName,
  getContractRiskBadgeVariant,
  getContractRiskLevel,
} from "../../lib/helpers";
import { canDelegateToYouthAcademy, isSeniorSquadPlayer } from "../../lib/playerSquad";
import { getInjurySeverity, resolveInjuryName } from "../../lib/injury";
import { useTranslation } from "react-i18next";
import ContextMenu, { type ContextMenuHandle } from "../ContextMenu";
import { clearContractExitIntent, setContractExitIntent } from "../../services/contractService";
import { setPlayerSquadRole, setStartingXi } from "../../services/squadService";
import { toggleLoanList, toggleTransferList } from "../../services/transfersService";
import {
  buildActivePositionMap,
  buildRoleCoverageSummary,
  buildDemoteFromStartingXi,
  getBestRoleForFormation,
  getCurrentPosition,
  getPlayStyleFit,
  buildPitchRows,
  buildPitchSlotRows,
  buildPromoteToStartingXi,
  buildStartingXIIds,
  CORE_POSITIONS,
  getPreferredPositions,
  getSquadTacticalFit,
  isPlayerOutOfPosition,
  normalisePosition,
  positionSortRank,
  translatePositionAbbreviation,
} from "./SquadTab.helpers";
import { findTacticsPresetBySetup } from "../tactics/TacticsTab.helpers";
import {
  buildDelegateToYouthAcademyMenuItem,
  buildDividerMenuItem,
  buildToggleLoanListMenuItem,
  buildToggleTransferListMenuItem,
  buildViewProfileMenuItem,
} from "../playerActions/playerContextMenuItems";
import {
  DEFAULT_SQUAD_LIST_SORT_STATE,
  SQUAD_VIEW_COLUMNS,
  type SquadRosterViewMode,
  type SquadListSortKey,
  type SquadListSortState,
} from "./SquadRosterView.state";

import SquadPlayerDetail from "./SquadPlayerDetail";
import SquadRosterCell from "./SquadRosterCell";

interface SquadRosterViewProps {
  players: PlayerData[];
  team: TeamData;
  clockDate: string;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
  onMutationComplete?: (g: GameStateData) => void;
  sortState?: SquadListSortState;
  onSortStateChange?: (sortState: SquadListSortState) => void;
}

type FilterScope =
  | "all"
  | "xi"
  | "bench"
  | "naturalFit"
  | "needsCover"
  | "outOfPosition"
  | "injured";

/**
 * Declared at module scope on purpose. Defined inside `SquadRosterView` it was a *new component
 * type* on every render, so React unmounted and remounted all ten header cells each time the
 * sort changed — the thing `noNestedComponentDefinitions` exists to catch.
 */
function SortHeader({
  col,
  label,
  sortKey,
  sortDir,
  onSort,
}: {
  col: SquadListSortKey;
  label: string;
  sortKey: SquadListSortKey;
  sortDir: "asc" | "desc";
  onSort: (col: SquadListSortKey) => void;
}) {
  const active = sortKey === col;

  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`py-2.5 px-3 font-heading font-bold uppercase tracking-wider ${active ? "text-primary-700 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className="flex items-center gap-1 whitespace-nowrap rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 hover:text-primary-700 dark:hover:text-primary-400"
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp aria-hidden="true" className="w-3 h-3" />
          ) : (
            <ChevronDown aria-hidden="true" className="w-3 h-3" />
          )
        ) : null}
      </button>
    </th>
  );
}

export default function SquadRosterView({
  players,
  team,
  clockDate,
  onSelectPlayer,
  onMutationComplete,
  sortState,
  onSortStateChange,
}: SquadRosterViewProps) {
  const { t } = useTranslation();
  const filterId = useId();
  const [view, setView] = useState<SquadRosterViewMode>("general");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [otherViewSorts, setOtherViewSorts] = useState<
    Record<"statistics" | "finances", SquadListSortState>
  >({
    statistics: { sortKey: "appearances", sortDir: "desc" },
    finances: { sortKey: "wage", sortDir: "desc" },
  });
  const columns = SQUAD_VIEW_COLUMNS[view];
  const [playerSearch, setPlayerSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<FilterScope>("all");
  const [localSortState, setLocalSortState] = useState<SquadListSortState>(
    DEFAULT_SQUAD_LIST_SORT_STATE,
  );
  const [contractActionPlayerId, setContractActionPlayerId] = useState<string | null>(null);
  const [contractActionError, setContractActionError] = useState<string | null>(null);
  const menuRefs = useRef<Map<string, ContextMenuHandle>>(new Map());
  const [openMenuPlayerId, setOpenMenuPlayerId] = useState<string | null>(null);

  const posOrder: Record<string, number> = {
    Goalkeeper: 1,
    Defender: 2,
    Midfielder: 3,
    Forward: 4,
  };

  const roster = players
    .filter((player) => isSeniorSquadPlayer(player))
    .sort(
      (a, b) =>
        (posOrder[normalisePosition(a.position)] || 99) -
          (posOrder[normalisePosition(b.position)] || 99) || getPlayerOvr(b) - getPlayerOvr(a),
    );

  const playersById = useMemo(() => new Map(roster.map((player) => [player.id, player])), [roster]);

  const available = roster.filter((player) => !player.injury);
  const formation = team.formation || "4-4-2";
  const activePlayStyle = team.play_style || "Balanced";
  const currentPreset = findTacticsPresetBySetup(formation, activePlayStyle);
  const startingXiIds = useMemo(
    () => buildStartingXIIds(available, team.starting_xi_ids || [], formation),
    [available, team.starting_xi_ids, formation],
  );
  const pitchSlotRows = buildPitchSlotRows(buildPitchRows(formation), startingXiIds, playersById);
  const xiActivePosition = buildActivePositionMap(pitchSlotRows);
  const xiIds = useMemo(() => new Set(startingXiIds), [startingXiIds]);
  const roleCoverage = useMemo(
    () => buildRoleCoverageSummary(available, startingXiIds, formation),
    [available, startingXiIds, formation],
  );
  const rolesNeedingCover = useMemo(
    () =>
      new Set(
        roleCoverage
          .filter((coverage) => coverage.status !== "covered")
          .map((coverage) => coverage.role),
      ),
    [roleCoverage],
  );
  const activeSortState = view === "general" ? (sortState ?? localSortState) : otherViewSorts[view];
  const sortKey = activeSortState.sortKey;
  const sortDir = activeSortState.sortDir;

  const updateSortState = (nextSortState: SquadListSortState) => {
    if (view !== "general") {
      setOtherViewSorts((previous) => ({ ...previous, [view]: nextSortState }));
      return;
    }
    if (onSortStateChange) {
      onSortStateChange(nextSortState);
      return;
    }

    setLocalSortState(nextSortState);
  };

  const toggleSort = (key: SquadListSortKey) => {
    if (sortKey === key) {
      updateSortState({
        sortKey,
        sortDir: sortDir === "asc" ? "desc" : "asc",
      });
      return;
    }

    // Sensible starting direction per column: OVR, condition, morale default
    // to desc (higher first); everything else defaults to asc.
    const descByDefault: SquadListSortKey[] = [
      "ovr",
      "condition",
      "morale",
      "appearances",
      "goals",
      "assists",
      "yellow_cards",
      "red_cards",
      "avg_rating",
      "wage",
      "market_value",
    ];
    updateSortState({
      sortKey: key,
      sortDir: descByDefault.includes(key) ? "desc" : "asc",
    });
  };

  const isOutOfPosition = (player: PlayerData): boolean => {
    return (
      xiIds.has(player.id) &&
      isPlayerOutOfPosition(player, getCurrentPosition(player, xiActivePosition))
    );
  };

  const getTacticalFit = (player: PlayerData) => {
    return getSquadTacticalFit(player, getCurrentPosition(player, xiActivePosition));
  };

  const matchesFilters = (player: PlayerData): boolean => {
    const inXI = xiIds.has(player.id);
    const currentPos = normalisePosition(getCurrentPosition(player, xiActivePosition));
    const preferredPositions = getPreferredPositions(player);
    const search = playerSearch.trim().toLowerCase();

    if (search) {
      const searchable = [
        player.full_name,
        getPlayerDisplayName(player),
        currentPos,
        ...preferredPositions,
        ...preferredPositions.map((position) => translatePositionAbbreviation(t, position)),
      ]
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(search)) return false;
    }

    if (
      positionFilter !== "All" &&
      currentPos !== positionFilter &&
      !preferredPositions.includes(positionFilter)
    ) {
      return false;
    }

    switch (statusFilter) {
      case "xi":
        return inXI;
      case "bench":
        return !inXI;
      case "naturalFit":
        return getTacticalFit(player) === "natural";
      case "needsCover":
        return rolesNeedingCover.has(getBestRoleForFormation(player, formation));
      case "outOfPosition":
        return isOutOfPosition(player);
      case "injured":
        return Boolean(player.injury);
      default:
        return true;
    }
  };

  const filteredRoster = useMemo(() => {
    const list = roster.filter((player) => matchesFilters(player));

    // Fit-tier rank: lower is a better fit. Non-XI players sort as -1 so
    // they cluster together separately from XI-tiered rows.
    const fitRank = (player: PlayerData): number => {
      if (!xiIds.has(player.id)) return -1;
      const fit = getTacticalFit(player);
      return fit === "natural" ? 0 : fit === "adapted" ? 1 : 2;
    };

    // Style-fit rank: lower is a better style match.
    const styleRank = (player: PlayerData): number => {
      const style = getPlayStyleFit(
        player,
        activePlayStyle,
        getCurrentPosition(player, xiActivePosition),
      );
      return style === "strong" ? 0 : style === "good" ? 1 : 2;
    };

    // Contract-remaining rank for sorting: sooner-expiring first when asc.
    // Missing contract_end sorts last.
    const contractRank = (player: PlayerData): string => player.contract_end ?? "9999-99-99";

    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case "jersey":
          return (a.jersey_number ?? 999) - (b.jersey_number ?? 999);
        case "name":
          return a.full_name.localeCompare(b.full_name);
        case "pos": {
          // XI-first, then football-canonical natural_position order, then
          // OVR desc. This is the default landing view: starters cluster on
          // top, sorted by where they play; strongest at each slot rises.
          const aXi = xiIds.has(a.id) ? 0 : 1;
          const bXi = xiIds.has(b.id) ? 0 : 1;
          if (aXi !== bXi) return aXi - bXi;

          const aRank = positionSortRank(a.natural_position || a.position);
          const bRank = positionSortRank(b.natural_position || b.position);
          if (aRank !== bRank) return aRank - bRank;

          return getPlayerOvr(b) - getPlayerOvr(a);
        }
        case "fit":
          return fitRank(a) - fitRank(b);
        case "style":
          return styleRank(a) - styleRank(b);
        case "age":
          return new Date(b.date_of_birth).getTime() - new Date(a.date_of_birth).getTime();
        case "condition":
          return a.condition - b.condition;
        case "morale":
          return a.morale - b.morale;
        case "ovr":
          return getPlayerOvr(a) - getPlayerOvr(b);
        case "appearances":
        case "goals":
        case "assists":
        case "yellow_cards":
        case "red_cards":
        case "avg_rating":
          return a.stats[sortKey] - b.stats[sortKey];
        case "wage":
        case "market_value":
          return a[sortKey] - b[sortKey];
        case "contract":
          return contractRank(a).localeCompare(contractRank(b));
        default:
          return 0;
      }
    });

    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [
    activePlayStyle,
    formation,
    playerSearch,
    positionFilter,
    roleCoverage,
    roster,
    sortDir,
    sortKey,
    startingXiIds,
    statusFilter,
    t,
    xiActivePosition,
    xiIds,
  ]);

  const selectedPlayer =
    filteredRoster.find((player) => player.id === selectedPlayerId) ?? filteredRoster[0] ?? null;

  useEffect(() => {
    setSelectedPlayerId(selectedPlayer?.id ?? null);
  }, [selectedPlayer?.id]);

  const hasActiveFilters =
    playerSearch.trim().length > 0 || positionFilter !== "All" || statusFilter !== "all";
  const starterCount = startingXiIds.length;
  const benchCount = Math.max(roster.length - starterCount, 0);
  const naturalFitCount = roster.filter((player) => getTacticalFit(player) === "natural").length;
  const outOfPositionCount = roster.filter((player) => isOutOfPosition(player)).length;
  const injuredCount = roster.filter((player) => player.injury).length;
  const thinCoverageCount = roleCoverage.filter((coverage) => coverage.status !== "covered").length;

  const persistStartingXi = async (playerIds: string[]): Promise<void> => {
    const updated = await setStartingXi(playerIds);
    onMutationComplete?.(updated);
  };

  const updateContractExitIntent = async (
    playerId: string,
    shouldLetExpire: boolean,
  ): Promise<void> => {
    setContractActionPlayerId(playerId);
    setContractActionError(null);

    try {
      const result = shouldLetExpire
        ? await setContractExitIntent(playerId, "manager_squad_action")
        : await clearContractExitIntent(playerId);
      onMutationComplete?.(result.game);
    } catch (error) {
      setContractActionError(String(error));
    } finally {
      setContractActionPlayerId(null);
    }
  };

  const updateSquadPlanning = async (
    playerId: string,
    action: "promote" | "demote",
  ): Promise<void> => {
    const nextXiIds =
      action === "promote"
        ? buildPromoteToStartingXi(startingXiIds, playersById, formation, playerId)
        : buildDemoteFromStartingXi(startingXiIds, available, formation, playerId);

    if (!nextXiIds || nextXiIds.join(",") === startingXiIds.join(",")) {
      return;
    }

    try {
      await persistStartingXi(nextXiIds);
    } catch (error) {
      setContractActionError(String(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_220px_220px_auto] gap-3 items-end">
          <div>
            <label
              htmlFor={`${filterId}-search`}
              className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 block"
            >
              {t("common.search")}
            </label>
            <input
              id={`${filterId}-search`}
              type="text"
              value={playerSearch}
              onChange={(event) => setPlayerSearch(event.target.value)}
              placeholder={t("squad.filterPlayers")}
              className="w-full rounded-lg border border-gray-200 dark:border-navy-600 bg-white dark:bg-navy-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>
          <div>
            <label
              htmlFor={`${filterId}-position`}
              className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 block"
            >
              {t("squad.pos")}
            </label>
            <Select
              id={`${filterId}-position`}
              value={positionFilter}
              onChange={(event) => setPositionFilter(event.target.value)}
              fullWidth
            >
              <option value="All">{t("common.all")}</option>
              {CORE_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {translatePositionAbbreviation(t, position)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label
              htmlFor={`${filterId}-status`}
              className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 block"
            >
              {t("common.status")}
            </label>
            <Select
              id={`${filterId}-status`}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as FilterScope)}
              fullWidth
            >
              <option value="all">{t("common.allPlayers")}</option>
              <option value="xi">{t("preMatch.startingXI")}</option>
              <option value="bench">{t("preMatch.substitutes")}</option>
              <option value="naturalFit">{t("squad.naturalFit")}</option>
              <option value="needsCover">{t("squad.needsCover")}</option>
              <option value="outOfPosition">{t("squad.outOfPosition")}</option>
              <option value="injured">{t("common.injured")}</option>
            </Select>
          </div>
          <button
            type="button"
            onClick={() => {
              setPlayerSearch("");
              setPositionFilter("All");
              setStatusFilter("all");
            }}
            disabled={!hasActiveFilters}
            className={`px-3 py-2 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all ${
              hasActiveFilters
                ? "bg-gray-100 dark:bg-navy-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-navy-600"
                : "bg-gray-100 dark:bg-navy-700 text-gray-400 cursor-not-allowed"
            }`}
          >
            {t("common.clear")}
          </button>
        </div>
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          <Badge variant="primary" size="sm">
            {starterCount} {t("squad.starter")}
          </Badge>
          <Badge variant="neutral" size="sm">
            {benchCount} {t("squad.benchOption")}
          </Badge>
          <Badge variant="success" size="sm">
            {naturalFitCount} {t("squad.naturalFit")}
          </Badge>
          <Badge variant={thinCoverageCount > 0 ? "accent" : "success"} size="sm">
            {thinCoverageCount} {t("squad.needsCover")}
          </Badge>
          <Badge variant={outOfPositionCount > 0 ? "danger" : "success"} size="sm">
            {outOfPositionCount} {t("squad.outOfPosition")}
          </Badge>
          <Badge variant={injuredCount > 0 ? "danger" : "neutral"} size="sm">
            {injuredCount} {t("common.injured")}
          </Badge>
          <Badge variant="primary" size="sm">
            {filteredRoster.length} {t("squad.playersLabel")}
          </Badge>
        </div>
      </Card>

      <fieldset aria-label={t("squad.viewControls")} className="flex flex-wrap gap-2">
        {(["general", "statistics", "finances"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => setView(mode)}
            className={`rounded-lg px-4 py-2 font-heading font-bold text-sm uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${view === mode ? "bg-primary-700 dark:bg-primary-700 text-white dark:text-white" : "bg-white dark:bg-navy-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-700"}`}
          >
            {t(`squad.views.${mode}`)}
          </button>
        ))}
      </fieldset>
      <Card>
        <div className="p-4 border-b border-gray-100 dark:border-navy-600 bg-linear-to-r from-navy-700 to-navy-800 rounded-t-xl">
          <h3 className="text-sm font-heading font-bold text-white uppercase tracking-wide flex items-center gap-2">
            <Users className="w-4 h-4 text-accent-400" />
            {t("squad.title", { team: team.name })}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {filteredRoster.length} / {roster.length} {t("squad.playersLabel")}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {t("squad.currentPlan")}: {formation} /{" "}
            {currentPreset
              ? t(`tactics.presetNames.${currentPreset.id}`, currentPreset.id)
              : t(`common.playStyles.${activePlayStyle}`, activePlayStyle)}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-heading font-bold uppercase tracking-wider text-gray-300">
                {t("squad.coverageTitle")}
              </span>
              <Badge variant={thinCoverageCount > 0 ? "danger" : "success"} size="sm">
                {thinCoverageCount > 0
                  ? t("squad.coverageNeedsAttention", {
                      count: thinCoverageCount,
                    })
                  : t("squad.coverageStable")}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {roleCoverage.map((coverage) => (
                <Badge
                  key={coverage.role}
                  variant={
                    coverage.status === "covered"
                      ? "success"
                      : coverage.status === "thin"
                        ? "accent"
                        : "danger"
                  }
                  size="sm"
                  className="gap-1"
                >
                  <span>{translatePositionAbbreviation(t, coverage.role)}</span>
                  <span>
                    {t("squad.coverageBadge", {
                      starters: coverage.naturalStarters,
                      required: coverage.requiredSlots,
                      bench: coverage.benchOptions,
                    })}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-navy-800 border-b border-gray-200 dark:border-navy-600 text-xs">
                  <SortHeader
                    col="name"
                    label={t("common.name")}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  {columns.map((column) => (
                    <SortHeader
                      key={column.key}
                      col={column.key}
                      label={t(column.labelKey)}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    />
                  ))}
                  <th scope="col" className="py-2.5 px-3">
                    <span className="sr-only">{t("common.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
                {filteredRoster.map((player) => {
                  const inXI = xiIds.has(player.id);
                  const currentPos = getCurrentPosition(player, xiActivePosition);
                  const contractRiskLevel = getContractRiskLevel(player.contract_end, clockDate);
                  const contractRiskLabel =
                    contractRiskLevel === "critical"
                      ? t("finances.contractRiskCritical")
                      : contractRiskLevel === "warning"
                        ? t("finances.contractRiskWarning")
                        : t("finances.contractRiskStable");
                  const hasLetExpireIntent =
                    player.morale_core?.renewal_state?.exit_intent?.kind === "let_expire";
                  const isContractActionSubmitting = contractActionPlayerId === player.id;

                  const injurySeverity = player.injury
                    ? getInjurySeverity(player.injury.days_remaining)
                    : null;
                  const injuryDotClass =
                    injurySeverity === "major"
                      ? "bg-red-500"
                      : injurySeverity === "serious"
                        ? "bg-orange-400"
                        : injurySeverity === "moderate"
                          ? "bg-amber-400"
                          : injurySeverity === "minor"
                            ? "bg-yellow-400"
                            : null;
                  const rowBorderClass = player.injury
                    ? injurySeverity === "major" || injurySeverity === "serious"
                      ? "border-l-2 border-l-red-500"
                      : "border-l-2 border-l-amber-400"
                    : contractRiskLevel === "critical"
                      ? "border-l-2 border-l-orange-500"
                      : contractRiskLevel === "warning"
                        ? "border-l-2 border-l-yellow-400"
                        : "";
                  const hasUrgentItems = Boolean(player.injury) || contractRiskLevel !== "stable";

                  const contextItems = [
                    ...(player.injury
                      ? [
                          {
                            type: "label" as const,
                            label: `${resolveInjuryName(player.injury.name, t)} — ${t("playerProfile.injuryDaysShort", { count: player.injury.days_remaining })}`,
                            icon: <AlertTriangle className="w-3.5 h-3.5" />,
                          },
                          buildDividerMenuItem(),
                        ]
                      : []),
                    buildViewProfileMenuItem(t, () => onSelectPlayer(player.id)),
                    inXI
                      ? {
                          label: t("squad.sendToBench"),
                          icon: <RotateCcw className="w-4 h-4" />,
                          disabled:
                            available.filter((candidate) => !xiIds.has(candidate.id)).length === 0,
                          onClick: () => {
                            void updateSquadPlanning(player.id, "demote");
                          },
                        }
                      : {
                          label: t("squad.makeStarter"),
                          icon: <Users className="w-4 h-4" />,
                          disabled: Boolean(player.injury),
                          onClick: () => {
                            void updateSquadPlanning(player.id, "promote");
                          },
                        },
                    buildDividerMenuItem(),
                    {
                      label: t("common.renewContract"),
                      icon: <Repeat className="w-4 h-4" />,
                      urgent: contractRiskLevel !== "stable",
                      disabled: !player.contract_end,
                      onClick: () =>
                        onSelectPlayer(player.id, {
                          openRenewal: true,
                        }),
                    },
                    hasLetExpireIntent
                      ? {
                          label: t("playerProfile.reopenContractTalks"),
                          icon: <RotateCcw className="w-4 h-4" />,
                          disabled: !player.contract_end || isContractActionSubmitting,
                          onClick: () => {
                            void updateContractExitIntent(player.id, false);
                          },
                        }
                      : {
                          label: t("playerProfile.letContractExpire"),
                          icon: <TimerOff className="w-4 h-4" />,
                          disabled: !player.contract_end || isContractActionSubmitting,
                          onClick: () => {
                            void updateContractExitIntent(player.id, true);
                          },
                        },
                    {
                      label: t("playerProfile.terminateContract"),
                      icon: <Trash2 className="w-4 h-4" />,
                      danger: true,
                      disabled: !player.contract_end,
                      onClick: () =>
                        onSelectPlayer(player.id, {
                          openTermination: true,
                        }),
                    },
                    buildDividerMenuItem(),
                    buildToggleTransferListMenuItem(t, player.transfer_listed, async () => {
                      try {
                        const updated = await toggleTransferList(player.id);
                        onMutationComplete?.(updated);
                      } catch {
                        return;
                      }
                    }),
                    buildToggleLoanListMenuItem(t, player.loan_listed, async () => {
                      try {
                        const updated = await toggleLoanList(player.id);
                        onMutationComplete?.(updated);
                      } catch {
                        return;
                      }
                    }),
                    ...(canDelegateToYouthAcademy(player)
                      ? [
                          buildDelegateToYouthAcademyMenuItem(t, async () => {
                            try {
                              const updated = await setPlayerSquadRole(player.id, "Youth");
                              onMutationComplete?.(updated);
                            } catch {
                              return;
                            }
                          }),
                        ]
                      : []),
                  ];

                  return (
                    <ContextMenu
                      items={contextItems}
                      key={player.id}
                      ref={(handle) => {
                        if (handle) menuRefs.current.set(player.id, handle);
                        else menuRefs.current.delete(player.id);
                      }}
                      onOpenChange={(open) => {
                        setOpenMenuPlayerId((prev) => {
                          if (open) return player.id;
                          return prev === player.id ? null : prev;
                        });
                      }}
                    >
                      <tr
                        onClick={() => setSelectedPlayerId(player.id)}
                        title={inXI ? t("squad.startingXi") : undefined}
                        className={`hover:bg-primary-500/5 dark:hover:bg-navy-700 transition-colors group cursor-pointer ${selectedPlayer?.id === player.id ? "bg-primary-50 dark:bg-primary-500/10" : ""} ${inXI ? "border-l-4 border-l-primary-500" : rowBorderClass}`}
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar player={player} />
                            <div className="min-w-0">
                              <button
                                type="button"
                                aria-pressed={selectedPlayer?.id === player.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedPlayerId(player.id);
                                }}
                                className="block whitespace-nowrap rounded text-left font-semibold text-sm text-gray-900 dark:text-gray-100 hover:text-primary-700 dark:hover:text-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
                              >
                                {getPlayerDisplayName(player)}
                              </button>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <CountryFlag
                                  code={player.nationality}
                                  className="text-xs leading-none shrink-0"
                                />
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {inXI ? t("squad.starter") : t("squad.benchOption")}
                                  {player.jersey_number ? ` · #${player.jersey_number}` : ""}
                                </span>
                                {injuryDotClass && (
                                  <span
                                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${injuryDotClass}`}
                                    aria-hidden="true"
                                  />
                                )}
                                {player.injury && <InjuryBadge injury={player.injury} />}
                                {contractRiskLevel !== "stable" && (
                                  <Badge
                                    variant={getContractRiskBadgeVariant(contractRiskLevel)}
                                    size="sm"
                                  >
                                    {contractRiskLabel}
                                  </Badge>
                                )}
                                {player.transfer_listed && (
                                  <Badge variant="accent" size="sm">
                                    {t("transfers.transfer")}
                                  </Badge>
                                )}
                                {player.loan_listed && (
                                  <Badge variant="primary" size="sm">
                                    {t("transfers.loan")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className="py-2.5 px-3 text-sm text-gray-600 dark:text-gray-400 tabular-nums"
                          >
                            <SquadRosterCell
                              player={player}
                              column={column.key}
                              currentPosition={currentPos}
                              formation={formation}
                              playStyle={activePlayStyle}
                              inXI={inXI}
                            />
                          </td>
                        ))}
                        {/* Actions (last column) */}
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              menuRefs.current.get(player.id)?.open(rect.left, rect.bottom + 4);
                            }}
                            aria-label={t("common.playerActions", {
                              name: getPlayerDisplayName(player),
                            })}
                            aria-haspopup="menu"
                            aria-expanded={openMenuPlayerId === player.id}
                            className="relative rounded-md p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 transition-colors"
                          >
                            <MoreVertical className="h-4 w-4" />
                            {hasUrgentItems && (
                              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
                            )}
                          </button>
                        </td>
                      </tr>
                    </ContextMenu>
                  );
                })}
              </tbody>
            </table>
            {filteredRoster.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400 font-heading uppercase tracking-wider text-sm">
                {t("squad.noPlayers")}
              </div>
            ) : null}
          </div>
        </Card>
        {selectedPlayer && (
          <SquadPlayerDetail
            player={selectedPlayer}
            view={view}
            clockDate={clockDate}
            currentPosition={getCurrentPosition(selectedPlayer, xiActivePosition)}
            playStyle={activePlayStyle}
            inXI={xiIds.has(selectedPlayer.id)}
            lineupActionDisabled={
              xiIds.has(selectedPlayer.id)
                ? available.filter((candidate) => !xiIds.has(candidate.id)).length === 0
                : Boolean(selectedPlayer.injury)
            }
            contractSubmitting={contractActionPlayerId === selectedPlayer.id}
            onToggleStartingXi={() => {
              void updateSquadPlanning(
                selectedPlayer.id,
                xiIds.has(selectedPlayer.id) ? "demote" : "promote",
              );
            }}
            onToggleContractExit={() => {
              void updateContractExitIntent(
                selectedPlayer.id,
                selectedPlayer.morale_core?.renewal_state?.exit_intent?.kind !== "let_expire",
              );
            }}
            onSelectPlayer={onSelectPlayer}
          />
        )}
      </div>

      {contractActionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {contractActionError}
        </div>
      ) : null}
    </div>
  );
}
