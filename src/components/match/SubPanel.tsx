import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { type EnginePlayerData, type MatchSnapshot, FORMATIONS, PLAY_STYLES } from "./types";
import { getPlayerName } from "./helpers";
import { FormationPitch } from "./FormationPitch";
import { condBgColor, condColor } from "../../lib/playerConditionDisplay";
import { Badge, Select } from "../ui";
import {
  ArrowLeftRight,
  RefreshCw,
  AlertTriangle,
  UserMinus,
  UserPlus,
  Shield,
  Swords,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import ContextMenu from "../ContextMenu";
import { canonicalPosition, translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { getPositionColor } from "../../lib/positionColors";
import {
  buildRecommendedSubstitutions,
  getMatchScenario,
  type MatchScenarioId,
} from "./SubPanel.helpers";
import { getRoleOptions } from "../../lib/playerRoles";
import type { PlayerRole } from "../../store/types";

type SortColumn = "name" | "position" | "ovr" | "condition";
type SortState = { column: SortColumn; direction: "asc" | "desc" } | null;
export type PendingSubstitution = { offId: string; onId: string };
const POSITION_SORT_ORDER: Record<string, number> = {
  Goalkeeper: 0,
  Defender: 1,
  Midfielder: 2,
  Forward: 3,
};

function SortableHeader({
  column,
  label,
  sortState,
  onSort,
  className = "",
}: {
  column: SortColumn;
  label: string;
  sortState: SortState;
  onSort: (column: SortColumn) => void;
  className?: string;
}) {
  const active = sortState?.column === column;
  return (
    <th
      className={`py-2 ${className}`}
      aria-sort={active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex cursor-pointer items-center gap-1 hover:text-primary-400 ${active ? "text-primary-400" : ""}`}
      >
        {label}
        {active ? (
          sortState.direction === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : null}
      </button>
    </th>
  );
}

function sortPlayers(players: EnginePlayerData[], sortState: SortState): EnginePlayerData[] {
  if (!sortState) return players;
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...players].sort((left, right) => {
    let comparison = 0;
    switch (sortState.column) {
      case "name":
        comparison = left.name.localeCompare(right.name);
        break;
      case "position":
        comparison =
          (POSITION_SORT_ORDER[canonicalPosition(left.position)] ?? 99) -
          (POSITION_SORT_ORDER[canonicalPosition(right.position)] ?? 99);
        break;
      case "ovr":
        comparison = left.ovr - right.ovr;
        break;
      case "condition":
        comparison = left.condition - right.condition;
        break;
    }
    return comparison * direction || left.name.localeCompare(right.name);
  });
}

const CompareBar = ({ label, valA, valB }: { label: string; valA: number; valB: number }) => {
  const diff = valB - valA;
  return (
    <div className="flex items-center gap-1.5 py-0.5 text-xs">
      <span className="w-7 text-right font-heading text-gray-500">{label}</span>
      <span className="w-5 text-right tabular-nums text-red-400">{valA}</span>
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-navy-600">
        <div className="h-full bg-red-500/60" style={{ width: `${valA}%` }} />
      </div>
      <div className="flex h-1.5 flex-1 justify-end overflow-hidden rounded-full bg-navy-600">
        <div className="h-full bg-green-500/60" style={{ width: `${valB}%` }} />
      </div>
      <span className="w-5 tabular-nums text-green-400">{valB}</span>
      <span
        className={`w-6 text-right tabular-nums font-heading font-bold ${diff > 0 ? "text-green-400" : diff < 0 ? "text-red-400" : "text-gray-600"}`}
      >
        {diff > 0 ? "+" : ""}
        {diff}
      </span>
    </div>
  );
};

export function SubPanel({
  snapshot,
  side,
  onSubstitute,
  onFormationChange,
  onPlayStyleChange,
  onPlayerRoleChange,
  onSwapPositions,
  onClose,
}: {
  snapshot: MatchSnapshot;
  side: "Home" | "Away";
  onSubstitute: (changes: PendingSubstitution[], keepOpen?: boolean) => Promise<void> | void;
  onFormationChange: (formation: string) => void;
  onPlayStyleChange: (playStyle: string) => void;
  onPlayerRoleChange: (playerId: string, role: PlayerRole) => void;
  onSwapPositions: (firstPlayerId: string, secondPlayerId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<{ off: string[]; on: string[] }>({ off: [], on: [] });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [offSort, setOffSort] = useState<SortState>(null);
  const [benchSort, setBenchSort] = useState<SortState>(null);
  const [positionSwapFirstId, setPositionSwapFirstId] = useState<string | null>(null);

  const team = side === "Home" ? snapshot.home_team : snapshot.away_team;
  const bench = side === "Home" ? snapshot.home_bench : snapshot.away_bench;
  const subsMade = side === "Home" ? snapshot.home_subs_made : snapshot.away_subs_made;
  const remainingSubs = Math.max(0, snapshot.max_subs - subsMade);
  const selectedOff = selection.off[0] ?? null;
  const selectedBench = selection.on[0] ?? null;
  const canConfirm =
    selection.off.length > 0 &&
    selection.off.length === selection.on.length &&
    selection.off.length <= remainingSubs;

  const subbedOnIds = new Set(
    snapshot.substitutions.filter((s) => s.side === side).map((s) => s.player_on_id),
  );
  const subbedOffIds = new Set(
    snapshot.substitutions.filter((s) => s.side === side).map((s) => s.player_off_id),
  );
  const availableBench = bench.filter((p) => !subbedOffIds.has(p.id) && !subbedOnIds.has(p.id));
  const selectedPlayer = selectedOff ? team.players.find((p) => p.id === selectedOff) : null;
  const comparedPlayer = selectedBench ? availableBench.find((p) => p.id === selectedBench) : null;

  const scenario = getMatchScenario(snapshot, side);
  const recommendations = buildRecommendedSubstitutions(snapshot, side);
  const visibleRecommendations = recommendations.flatMap((rec) => {
    const offPlayer = team.players.find((p) => p.id === rec.offId);
    const onPlayer = availableBench.find((p) => p.id === rec.onId);
    if (!offPlayer || !onPlayer) return [];
    return [{ rec, offPlayer, onPlayer }];
  });

  const getScenarioIcon = (id: MatchScenarioId) => {
    switch (id) {
      case "protect-lead":
        return <Shield className="h-3.5 w-3.5 text-primary-400" />;
      case "chase-goal":
        return <Swords className="h-3.5 w-3.5 text-accent-400" />;
      case "find-winner":
        return <Sparkles className="h-3.5 w-3.5 text-accent-400" />;
      default:
        return <RefreshCw className="h-3.5 w-3.5 text-gray-400" />;
    }
  };

  const handleClearSelection = () => {
    setSelection({ off: [], on: [] });
  };

  const handleSelectOffPlayer = (playerId: string) => {
    setSelection((current) => ({
      ...current,
      off: current.off.includes(playerId)
        ? current.off.filter((id) => id !== playerId)
        : current.off.length < remainingSubs
          ? [...current.off, playerId]
          : current.off,
    }));
  };

  const handleSelectBenchPlayer = (playerId: string) => {
    setSelection((current) => ({
      ...current,
      on: current.on.includes(playerId)
        ? current.on.filter((id) => id !== playerId)
        : current.on.length < remainingSubs
          ? [...current.on, playerId]
          : current.on,
    }));
  };

  const handlePair = (offId: string, onId: string) => {
    if (snapshot.sent_off.includes(offId) || !availableBench.some((p) => p.id === onId)) return;
    setSelection((current) => {
      const pairedCount = Math.min(current.off.length, current.on.length);
      const paired = current.off
        .slice(0, pairedCount)
        .map((id, index) => ({ offId: id, onId: current.on[index] }))
        .filter((pair) => pair.offId !== offId && pair.onId !== onId);
      const off = [
        ...paired.map((pair) => pair.offId),
        offId,
        ...current.off.slice(pairedCount).filter((id) => id !== offId),
      ];
      const on = [
        ...paired.map((pair) => pair.onId),
        onId,
        ...current.on.slice(pairedCount).filter((id) => id !== onId),
      ];
      return Math.max(off.length, on.length) <= remainingSubs ? { off, on } : current;
    });
  };

  const toggleSort = (
    setter: (state: SortState) => void,
    current: SortState,
    column: SortColumn,
  ) => {
    const defaultDirection = column === "ovr" || column === "condition" ? "desc" : "asc";
    setter({
      column,
      direction:
        current?.column === column
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : defaultDirection,
    });
  };

  const handlePlayerDragStart = (event: React.DragEvent<HTMLTableRowElement>, playerId: string) => {
    event.dataTransfer.setData("text/player-id", playerId);
    event.dataTransfer.effectAllowed = "move";
  };

  const submitChanges = (changes: PendingSubstitution[], keepOpen = false) => {
    if (isSubmitting || changes.length === 0 || changes.length > remainingSubs) return;
    setIsSubmitting(true);
    Promise.resolve(keepOpen ? onSubstitute(changes, true) : onSubstitute(changes))
      .then(() => {
        if (keepOpen) {
          setSelection({ off: [], on: [] });
          setIsSubmitting(false);
        }
      })
      .catch(() => {
        setSelection({ off: [], on: [] });
        setIsSubmitting(false);
      });
  };

  const handleDroppedPair = (offId: string, onId: string) => {
    if (snapshot.sent_off.includes(offId) || !availableBench.some((p) => p.id === onId)) return;
    if (selection.off.length === 0 && selection.on.length === 0) {
      submitChanges([{ offId, onId }], true);
    } else {
      handlePair(offId, onId);
    }
  };

  const handleDropOnOff = (event: React.DragEvent<HTMLTableRowElement>, playerId: string) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/player-id");
    if (!draggedId || draggedId === playerId) return;
    const draggedFromBench = availableBench.some((player) => player.id === draggedId);
    if (!draggedFromBench) return;
    handleDroppedPair(playerId, draggedId);
  };

  const handleDropOnBench = (event: React.DragEvent<HTMLTableRowElement>, playerId: string) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/player-id");
    if (!draggedId || draggedId === playerId) return;
    const draggedFromField = team.players.some((player) => player.id === draggedId);
    if (!draggedFromField) return;
    handleDroppedPair(draggedId, playerId);
  };

  const sortedFieldPlayers = sortPlayers(
    team.players.filter((player) => !snapshot.sent_off.includes(player.id)),
    offSort,
  );
  const sortedBenchPlayers = sortPlayers(availableBench, benchSort);

  const handleConfirmSubstitution = () => {
    if (!canConfirm || isSubmitting || selection.off.length > remainingSubs) return;
    const changes = selection.off.map((offId, index) => ({ offId, onId: selection.on[index] }));
    submitChanges(changes);
  };

  const handleApplyRecommendation = (offId: string, onId: string) => {
    handlePair(offId, onId);
  };

  const handlePositionSwap = (playerId: string) => {
    if (!positionSwapFirstId) {
      setPositionSwapFirstId(playerId);
      return;
    }
    if (positionSwapFirstId !== playerId) {
      onSwapPositions(positionSwapFirstId, playerId);
    }
    setPositionSwapFirstId(null);
  };

  const handleInteractiveRowKeyDown = (event: KeyboardEvent<HTMLElement>, action: () => void) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      event.currentTarget.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-navy-800 rounded-2xl border border-gray-200 dark:border-navy-600 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden transition-colors duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-linear-to-r from-gray-100 to-white px-5 py-3 dark:border-navy-700 dark:from-navy-700 dark:to-navy-800">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="h-4 w-4 text-accent-400" />
            <h3 className="font-heading text-sm font-bold uppercase tracking-widest text-gray-900 dark:text-white">
              {t("dashboard.tactics")} / {t("match.substitutionsTitle")}
            </h3>
            <Badge variant={subsMade >= snapshot.max_subs ? "danger" : "primary"} size="sm">
              {t("match.subsUsed", { used: subsMade, max: snapshot.max_subs })}
            </Badge>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-navy-600 dark:hover:text-white"
          >
            <span className="font-heading text-sm">✕</span>
          </button>
        </div>

        {subsMade >= snapshot.max_subs && (
          <div className="flex shrink-0 items-center justify-center gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4" />
            <p className="font-heading text-xs font-bold uppercase tracking-wider">
              {t("match.allSubsUsed")}
            </p>
          </div>
        )}
        {/* Tactics strip — scenario, recommendation chips, quick selects */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-gray-200 bg-gray-50/60 px-4 py-2 dark:border-navy-700 dark:bg-navy-900/30">
          {/* Scenario + apply play style */}
          <div className="flex items-center gap-1.5">
            {getScenarioIcon(scenario.id)}
            <span className="font-heading text-[11px] font-bold uppercase tracking-widest text-gray-800 dark:text-gray-200">
              {t(`match.subScenario.${scenario.id}.title`)}
            </span>
            <button
              type="button"
              data-testid="recommended-plan-cta"
              onClick={() => onPlayStyleChange(scenario.recommendedPlayStyle)}
              className="rounded-full border border-primary-500/25 bg-primary-500/12 px-2 py-0.5 font-heading text-[10px] font-bold uppercase tracking-widest text-primary-500 transition-colors hover:bg-primary-500/20 dark:text-primary-300"
            >
              {t("match.recommendedPlan")}:{" "}
              {t(`common.playStyles.${scenario.recommendedPlayStyle}`)}
            </button>
          </div>

          {/* Recommendation chips */}
          {visibleRecommendations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {visibleRecommendations.slice(0, 3).map(({ rec, offPlayer, onPlayer }) => (
                <button
                  key={`${rec.offId}-${rec.onId}`}
                  type="button"
                  data-testid={`recommended-sub-${rec.offId}-${rec.onId}`}
                  onClick={() => handleApplyRecommendation(rec.offId, rec.onId)}
                  className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 font-heading text-[10px] font-bold transition-colors hover:border-primary-400 hover:bg-primary-50 dark:border-navy-600 dark:bg-navy-800 dark:hover:bg-navy-700"
                >
                  <span className="text-red-400">{offPlayer.name.split(" ").pop()}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-green-400">{onPlayer.name.split(" ").pop()}</span>
                </button>
              ))}
              {visibleRecommendations.length > 3 && (
                <span className="font-heading text-[10px] text-gray-400 dark:text-gray-500">
                  +{visibleRecommendations.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Quick formation & play style selects */}
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={FORMATIONS.includes(team.formation) ? team.formation : FORMATIONS[0]}
              onChange={(e) => onFormationChange(e.target.value)}
              aria-label={t("tactics.formation")}
              selectSize="xs"
            >
              {FORMATIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Select
              value={team.play_style}
              onChange={(e) => onPlayStyleChange(e.target.value)}
              aria-label={t("tactics.playStyle")}
              selectSize="xs"
            >
              {PLAY_STYLES.map((style) => (
                <option key={style} value={style}>
                  {t(`common.playStyles.${style}`, style)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Main body: two columns */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: formation pitch + on-field player list */}
          <div className="flex min-w-0 flex-1 flex-col border-r border-gray-200 dark:border-navy-700">
            <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-navy-700 dark:bg-navy-800/50">
              <p className="font-heading text-xs uppercase tracking-widest text-red-400">
                {selectedOff
                  ? t("match.selectedToLeave", { count: selection.off.length })
                  : t("match.selectPlayerOff")}
              </p>
            </div>

            {/* Formation pitch */}
            <FormationPitch
              formation={team.formation}
              players={team.players}
              sentOff={snapshot.sent_off}
              selectedId={selectedOff}
              subbedOnIds={subbedOnIds}
              onPlayerClick={handleSelectOffPlayer}
              className="mx-4 mt-3 h-[210px] shrink-0"
            />

            {/* On-field player table */}
            <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-200 font-heading text-[10px] uppercase tracking-widest text-gray-600 dark:border-navy-700 dark:text-gray-500">
                    <SortableHeader
                      column="name"
                      label={t("match.player")}
                      sortState={offSort}
                      onSort={(column) => toggleSort(setOffSort, offSort, column)}
                      className="pr-2"
                    />
                    <SortableHeader
                      column="position"
                      label={t("common.position")}
                      sortState={offSort}
                      onSort={(column) => toggleSort(setOffSort, offSort, column)}
                      className="w-12 text-center"
                    />
                    <SortableHeader
                      column="ovr"
                      label={t("common.ovr")}
                      sortState={offSort}
                      onSort={(column) => toggleSort(setOffSort, offSort, column)}
                      className="w-12 text-center"
                    />
                    <SortableHeader
                      column="condition"
                      label={t("match.fitness")}
                      sortState={offSort}
                      onSort={(column) => toggleSort(setOffSort, offSort, column)}
                      className="w-24 text-left"
                    />
                    <th className="w-28 py-2 text-center">{t("tactics.playerRoleLabel")}</th>
                    <th className="w-9 py-2" aria-label={t("match.selectForSwap")} />
                  </tr>
                </thead>
                <tbody>
                  {sortedFieldPlayers.map((p) => {
                    const isSelected = selection.off.includes(p.id);
                    const isSubOn = subbedOnIds.has(p.id);
                    const row = (
                      <tr
                        key={p.id}
                        data-testid={`sub-panel-off-${p.id}`}
                        draggable
                        onDragStart={(event) => handlePlayerDragStart(event, p.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDropOnOff(event, p.id)}
                        onClick={(event) => {
                          if ((event.target as Element).closest("button")) return;
                          handleSelectOffPlayer(p.id);
                        }}
                        onKeyDown={(e) =>
                          handleInteractiveRowKeyDown(e, () => handleSelectOffPlayer(p.id))
                        }
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        className={`cursor-grab text-sm transition-colors active:cursor-grabbing ${
                          isSelected
                            ? "bg-red-500/10"
                            : "hover:bg-gray-100 dark:hover:bg-navy-700/50"
                        }`}
                      >
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-1.5">
                            {isSelected && (
                              <UserMinus className="h-3.5 w-3.5 shrink-0 text-red-400" />
                            )}
                            {isSubOn && <span className="text-[10px] text-green-400">▲</span>}
                            <span
                              className={`truncate font-medium ${isSelected ? "text-red-400" : "text-gray-700 dark:text-gray-300"}`}
                            >
                              {p.name}
                            </span>
                          </div>
                        </td>
                        <td className="w-12 py-2 text-center">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 font-heading text-[10px] font-bold uppercase tracking-wider text-white ${getPositionColor(canonicalPosition(p.position))}`}
                          >
                            {translatePositionAbbreviation(t, p.position)}
                          </span>
                        </td>
                        <td className="w-12 py-2 text-center font-heading font-bold text-gray-500 dark:text-gray-400">
                          {p.ovr}
                        </td>
                        <td className="w-24 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-300 dark:bg-navy-600">
                              <div
                                className={`h-full rounded-full ${condBgColor(p.condition)}`}
                                style={{ width: `${p.condition}%` }}
                              />
                            </div>
                            <span
                              className={`w-7 text-right font-heading text-xs tabular-nums ${condColor(p.condition)}`}
                            >
                              {Math.round(p.condition)}
                            </span>
                          </div>
                        </td>
                        <td className="w-28 py-2">
                          <Select
                            value={p.role}
                            onChange={(event) =>
                              onPlayerRoleChange(p.id, event.target.value as PlayerRole)
                            }
                            aria-label={`${p.name} · ${t("tactics.playerRoleLabel")}`}
                            selectSize="xs"
                            fullWidth
                          >
                            {getRoleOptions(p.position, p.role).map((role) => (
                              <option key={role} value={role}>
                                {t(`tactics.playerRoles.${role}`, role)}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="w-9 py-2 text-center">
                          <button
                            type="button"
                            aria-pressed={positionSwapFirstId === p.id}
                            aria-label={`${t("match.selectForSwap")}: ${p.name}`}
                            title={t("match.selectForSwap")}
                            onClick={(event) => {
                              event.stopPropagation();
                              handlePositionSwap(p.id);
                            }}
                            className={`rounded p-1 transition-colors ${
                              positionSwapFirstId === p.id
                                ? "bg-accent-500/20 text-accent-500 ring-1 ring-accent-500/50"
                                : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-navy-600 dark:hover:text-gray-200"
                            }`}
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                    return (
                      <ContextMenu
                        key={p.id}
                        items={[
                          {
                            label: isSelected ? t("common.cancel") : t("match.selectToTakeOff"),
                            icon: <UserMinus className="h-4 w-4" />,
                            onClick: () => handleSelectOffPlayer(p.id),
                          },
                        ]}
                      >
                        {row}
                      </ContextMenu>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: bench players (full column height) */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-navy-700 dark:bg-navy-800/50">
              <p className="font-heading text-xs uppercase tracking-widest text-green-400">
                {selection.on.length
                  ? t("match.selectedToEnter", { count: selection.on.length })
                  : t("match.selectReplacement")}
              </p>
            </div>

            {availableBench.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-xs text-gray-600 dark:text-gray-500">
                  {t("match.noBenchAvailable")}
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-200 font-heading text-[10px] uppercase tracking-widest text-gray-600 dark:border-navy-700 dark:text-gray-500">
                      <SortableHeader
                        column="name"
                        label={t("match.player")}
                        sortState={benchSort}
                        onSort={(column) => toggleSort(setBenchSort, benchSort, column)}
                        className="pr-2"
                      />
                      <SortableHeader
                        column="position"
                        label={t("common.position")}
                        sortState={benchSort}
                        onSort={(column) => toggleSort(setBenchSort, benchSort, column)}
                        className="w-12 text-center"
                      />
                      <SortableHeader
                        column="ovr"
                        label={t("common.ovr")}
                        sortState={benchSort}
                        onSort={(column) => toggleSort(setBenchSort, benchSort, column)}
                        className="w-12 text-center"
                      />
                      <SortableHeader
                        column="condition"
                        label={t("match.fitness")}
                        sortState={benchSort}
                        onSort={(column) => toggleSort(setBenchSort, benchSort, column)}
                        className="w-24 text-left"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBenchPlayers.map((p) => {
                      const posMatch = selectedPlayer
                        ? p.position === selectedPlayer.position
                        : true;
                      const benchRow = (
                        <tr
                          key={p.id}
                          data-testid={`sub-panel-bench-${p.id}`}
                          draggable
                          onDragStart={(event) => handlePlayerDragStart(event, p.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => handleDropOnBench(event, p.id)}
                          onClick={() => handleSelectBenchPlayer(p.id)}
                          onKeyDown={(e) =>
                            handleInteractiveRowKeyDown(e, () => handleSelectBenchPlayer(p.id))
                          }
                          role="button"
                          tabIndex={0}
                          aria-pressed={selection.on.includes(p.id)}
                          className={`cursor-grab text-sm transition-colors active:cursor-grabbing ${
                            selection.on.length
                              ? selection.on.includes(p.id)
                                ? "cursor-pointer bg-green-500/15 ring-1 ring-green-500/30"
                                : "cursor-pointer hover:bg-green-500/10"
                              : "hover:bg-green-500/10"
                          }`}
                        >
                          <td className="py-2 pr-2">
                            <div className="flex items-center gap-1.5">
                              {selection.on.includes(p.id) && (
                                <UserPlus className="h-3.5 w-3.5 shrink-0 text-green-400/50" />
                              )}
                              <span className="truncate font-medium text-gray-700 dark:text-gray-300">
                                {p.name}
                              </span>
                            </div>
                          </td>
                          <td className="w-12 py-2 text-center">
                            <span className="inline-flex items-center gap-1">
                              <span
                                className={`inline-flex rounded px-1.5 py-0.5 font-heading text-[10px] font-bold uppercase tracking-wider text-white ${getPositionColor(canonicalPosition(p.position))}`}
                              >
                                {translatePositionAbbreviation(t, p.position)}
                              </span>
                              {!posMatch && selectedOff && (
                                <span className="font-heading text-xs font-bold text-yellow-400">
                                  !
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="w-12 py-2 text-center font-heading font-bold text-gray-500 dark:text-gray-400">
                            {p.ovr}
                          </td>
                          <td className="w-24 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-300 dark:bg-navy-600">
                                <div
                                  className={`h-full rounded-full ${condBgColor(p.condition)}`}
                                  style={{ width: `${p.condition}%` }}
                                />
                              </div>
                              <span
                                className={`w-7 text-right font-heading text-xs tabular-nums ${condColor(p.condition)}`}
                              >
                                {Math.round(p.condition)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                      return (
                        <ContextMenu
                          key={p.id}
                          items={[
                            {
                              label: selection.on.includes(p.id)
                                ? t("match.clearReplacementSelection")
                                : t("match.selectReplacementMenu"),
                              icon: <UserPlus className="h-4 w-4" />,
                              onClick: () => handleSelectBenchPlayer(p.id),
                            },
                          ]}
                        >
                          {benchRow}
                        </ContextMenu>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub history */}
            {snapshot.substitutions.filter((s) => s.side === side).length > 0 && (
              <div className="shrink-0 border-t border-gray-200 px-4 py-3 dark:border-navy-700">
                <p className="mb-1.5 font-heading text-[10px] uppercase tracking-widest text-gray-600 dark:text-gray-500">
                  {t("match.history")}
                </p>
                {snapshot.substitutions
                  .filter((s) => s.side === side)
                  .map((sub, i) => (
                    <div key={i} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                      <span className="w-5 text-right font-heading tabular-nums text-gray-600 dark:text-gray-500">
                        {sub.minute}'
                      </span>
                      <span className="text-green-400">▲</span>
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {getPlayerName(snapshot, sub.player_on_id)}
                      </span>
                      <span className="text-red-400">▼</span>
                      <span className="truncate text-gray-500 dark:text-gray-400">
                        {getPlayerName(snapshot, sub.player_off_id)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer: comparison summary + confirm / cancel */}
        <div className="shrink-0 border-t border-gray-200 bg-gray-50/60 px-4 py-3 dark:border-navy-700 dark:bg-navy-900/30">
          {(selection.off.length > 0 || selection.on.length > 0) && (
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0 text-xs text-gray-700 dark:text-gray-300">
                <p className="mb-1 font-heading font-bold">
                  {t("match.pendingSubstitutions", {
                    off: selection.off.length,
                    on: selection.on.length,
                    max: remainingSubs,
                  })}
                </p>
                {selection.off.map((offId, index) => (
                  <p key={offId}>
                    {team.players.find((player) => player.id === offId)?.name} →{" "}
                    {availableBench.find((player) => player.id === selection.on[index])?.name ??
                      "…"}
                  </p>
                ))}
                {selection.on.slice(selection.off.length).map((onId) => (
                  <p key={onId}>… → {availableBench.find((player) => player.id === onId)?.name}</p>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearSelection}
                  disabled={isSubmitting}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-100 dark:border-navy-500 dark:text-gray-300 dark:hover:bg-navy-600"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSubstitution}
                  disabled={!canConfirm || isSubmitting}
                  className="rounded-lg bg-green-500 px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("match.confirmSubstitution")}
                </button>
              </div>
            </div>
          )}
          {selectedPlayer && comparedPlayer ? (
            <div>
              {/* Player names + position match + action buttons */}
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex items-center gap-1.5">
                  <UserMinus className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  <span className="max-w-[110px] truncate font-heading text-sm font-bold text-red-400">
                    {selectedPlayer.name}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className="max-w-[110px] truncate font-heading text-sm font-bold text-green-400">
                    {comparedPlayer.name}
                  </span>
                  <UserPlus className="h-3.5 w-3.5 shrink-0 text-green-400" />
                </div>
                <span
                  className={`font-heading text-[10px] font-bold uppercase tracking-wide ${
                    comparedPlayer.position === selectedPlayer.position
                      ? "text-green-400"
                      : "text-yellow-400"
                  }`}
                >
                  {comparedPlayer.position === selectedPlayer.position
                    ? t("match.fitExact")
                    : t("match.fitAdjusted")}
                </span>
              </div>
              {/* Attribute comparison bars */}
              <div className="grid grid-cols-2 gap-x-4">
                <CompareBar label="OVR" valA={selectedPlayer.ovr} valB={comparedPlayer.ovr} />
                <CompareBar label="PAC" valA={selectedPlayer.pace} valB={comparedPlayer.pace} />
                <CompareBar
                  label="PAS"
                  valA={selectedPlayer.passing}
                  valB={comparedPlayer.passing}
                />
                <CompareBar
                  label="SHO"
                  valA={selectedPlayer.shooting}
                  valB={comparedPlayer.shooting}
                />
                <CompareBar
                  label="TAC"
                  valA={selectedPlayer.tackling}
                  valB={comparedPlayer.tackling}
                />
                <CompareBar
                  label="COND"
                  valA={Math.round(selectedPlayer.condition)}
                  valB={Math.round(comparedPlayer.condition)}
                />
              </div>
            </div>
          ) : selectedPlayer ? (
            <div className="flex items-center gap-2">
              <UserMinus className="h-3.5 w-3.5 text-red-400" />
              <span className="font-heading text-sm font-bold text-red-400">
                {selectedPlayer.name}
              </span>
              <span className="text-gray-400">—</span>
              <span className="font-heading text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("match.selectBenchToCompare")}
              </span>
            </div>
          ) : (
            <p className="text-center font-heading text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400">
              {t("match.selectPlayerOff")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
