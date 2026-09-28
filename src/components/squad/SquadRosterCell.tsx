import { useTranslation } from "react-i18next";
import type { PlayerData } from "../../store/gameStore";
import { Badge, ProgressBar } from "../ui";
import {
  formatContractEndDate,
  formatVal,
  getPlayerOvr,
  positionBadgeVariant,
} from "../../lib/helpers";
import { annualAmountToWeeklyCommitment } from "../../lib/finance";
import {
  getBestRoleForFormation,
  getPlayStyleFit,
  getSquadTacticalFit,
  translatePositionAbbreviation,
} from "./SquadTab.helpers";
import type { SquadListSortKey } from "./SquadRosterView.state";

export default function SquadRosterCell({
  player,
  column,
  currentPosition,
  formation,
  playStyle,
  inXI,
}: {
  player: PlayerData;
  column: SquadListSortKey;
  currentPosition: string;
  formation: string;
  playStyle: string;
  inXI: boolean;
}) {
  const { t } = useTranslation();
  switch (column) {
    case "pos":
      return (
        <Badge variant={positionBadgeVariant(player.natural_position || player.position)} size="sm">
          {translatePositionAbbreviation(t, player.natural_position || player.position)}
        </Badge>
      );
    case "fit": {
      const fit = getSquadTacticalFit(player, currentPosition);
      return (
        <Badge
          variant={
            !inXI
              ? "neutral"
              : fit === "natural"
                ? "success"
                : fit === "adapted"
                  ? "accent"
                  : "danger"
          }
          size="sm"
        >
          {translatePositionAbbreviation(
            t,
            inXI ? currentPosition : getBestRoleForFormation(player, formation),
          )}
        </Badge>
      );
    }
    case "style": {
      const fit = getPlayStyleFit(player, playStyle, currentPosition);
      return (
        <Badge
          variant={fit === "strong" ? "success" : fit === "good" ? "accent" : "danger"}
          size="sm"
        >
          {t(`squad.styleFitShort.${fit}`)}
        </Badge>
      );
    }
    case "condition":
      return (
        <div className="min-w-16">
          <ProgressBar value={player.condition} variant="auto" size="sm" showLabel />
        </div>
      );
    case "ovr":
      return (
        <span className="font-heading font-bold text-primary-700 dark:text-primary-400">
          {getPlayerOvr(player)}
        </span>
      );
    case "wage":
      return formatVal(annualAmountToWeeklyCommitment(player.wage));
    case "market_value":
      return formatVal(player.market_value);
    case "contract":
      return (
        <span className="whitespace-nowrap">
          {formatContractEndDate(player.contract_end) || "—"}
        </span>
      );
    case "appearances":
    case "goals":
    case "assists":
    case "yellow_cards":
    case "red_cards":
      return player.stats[column];
    case "avg_rating":
      return player.stats.appearances > 0 && player.stats.avg_rating > 0
        ? player.stats.avg_rating.toFixed(1)
        : "—";
    default:
      return null;
  }
}
