import { useTranslation } from "react-i18next";
import { Badge, Button, Card, CardBody, CountryFlag, PlayerAvatar, ProgressBar } from "../ui";
import type { PlayerData, PlayerSelectionOptions } from "../../store/gameStore";
import { getPlayerOvr, positionBadgeVariant, getContractRiskLevel } from "../../lib/helpers";
import { calcAgeOnDate } from "../../lib/valueFormatting";
import { TraitList } from "../TraitBadge";
import PlayerProfileAttributesCard from "../playerProfile/PlayerProfileAttributesCard";
import PlayerProfileSeasonStatsCard from "../playerProfile/PlayerProfileSeasonStatsCard";
import PlayerProfileContractCard from "../playerProfile/PlayerProfileContractCard";
import {
  buildPlayerAttributeGroups,
  isGoalkeeper,
} from "../playerProfile/PlayerProfile.attributes";
import {
  getPreferredPositions,
  getPlayStyleFit,
  getSquadTacticalFit,
  translatePositionAbbreviation,
} from "./SquadTab.helpers";
import type { SquadRosterViewMode } from "./SquadRosterView.state";

interface SquadPlayerDetailProps {
  player: PlayerData;
  view: SquadRosterViewMode;
  clockDate: string;
  currentPosition: string;
  playStyle: string;
  inXI: boolean;
  lineupActionDisabled: boolean;
  contractSubmitting: boolean;
  onToggleStartingXi: () => void;
  onToggleContractExit: () => void;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
}

export default function SquadPlayerDetail({
  player,
  view,
  clockDate,
  currentPosition,
  playStyle,
  inXI,
  lineupActionDisabled,
  contractSubmitting,
  onToggleStartingXi,
  onToggleContractExit,
  onSelectPlayer,
}: SquadPlayerDetailProps) {
  const { t, i18n } = useTranslation();
  const fit = getSquadTacticalFit(player, currentPosition);
  const styleFit = getPlayStyleFit(player, playStyle, currentPosition);
  const contractRisk = getContractRiskLevel(player.contract_end, clockDate);
  const hasLetExpireIntent = player.morale_core?.renewal_state?.exit_intent?.kind === "let_expire";

  return (
    <section
      aria-label={t("squad.playerDetails")}
      className="min-w-0 flex flex-col gap-4 lg:sticky lg:top-4"
    >
      <Card>
        <CardBody>
          <div className="flex items-start gap-4">
            <PlayerAvatar
              player={player}
              className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-navy-700"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("squad.playerDetails")}
              </p>
              <h3
                aria-live="polite"
                className="font-heading font-bold text-2xl text-gray-900 dark:text-gray-100"
              >
                {player.full_name}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CountryFlag code={player.nationality} />
                <Badge variant="neutral" size="sm">
                  {t("common.age")}: {calcAgeOnDate(player.date_of_birth, clockDate)}
                </Badge>
                <Badge variant="primary" size="sm">
                  {t("common.ovr")}: {getPlayerOvr(player)}
                </Badge>
                <Badge variant={inXI ? "success" : "neutral"} size="sm">
                  {inXI ? t("squad.starter") : t("squad.benchOption")}
                </Badge>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onSelectPlayer(player.id)}>
              {t("squad.viewProfile")}
            </Button>
            {view === "general" && (
              <Button size="sm" disabled={lineupActionDisabled} onClick={onToggleStartingXi}>
                {inXI ? t("squad.sendToBench") : t("squad.makeStarter")}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {view === "general" && (
        <>
          <Card>
            <CardBody>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    {t("squad.pos")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {getPreferredPositions(player).map((position, index) => (
                      <Badge
                        key={position}
                        variant={index === 0 ? positionBadgeVariant(position) : "neutral"}
                        size="sm"
                      >
                        {translatePositionAbbreviation(t, position)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    {t("squad.formationFit")}
                  </p>
                  <Badge
                    variant={
                      fit === "natural" ? "success" : fit === "adapted" ? "accent" : "danger"
                    }
                    size="sm"
                  >
                    {translatePositionAbbreviation(t, currentPosition)} ·{" "}
                    {fit === "natural"
                      ? t("squad.naturalFit")
                      : fit === "adapted"
                        ? t("squad.adaptedFit")
                        : t("squad.outOfPosition")}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    {t("squad.styleFit")}
                  </p>
                  <Badge
                    variant={
                      styleFit === "strong" ? "success" : styleFit === "good" ? "accent" : "danger"
                    }
                    size="sm"
                  >
                    {t(`squad.styleFitValues.${styleFit}`)}
                  </Badge>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t(`common.playStyles.${playStyle}`)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    {t("squad.traits")}
                  </p>
                  <TraitList traits={player.traits ?? []} size="xs" />
                </div>
                <div>
                  <p className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    {t("common.condition")}
                  </p>
                  <ProgressBar value={player.condition} variant="auto" showLabel size="sm" />
                </div>
                <div>
                  <p className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    {t("common.morale")}
                  </p>
                  <ProgressBar value={player.morale} variant="auto" showLabel size="sm" />
                </div>
              </div>
            </CardBody>
          </Card>
          <PlayerProfileAttributesCard
            key={player.id}
            player={player}
            attrGroups={buildPlayerAttributeGroups(player, t)}
            isOwnClub
            isGk={isGoalkeeper(player)}
            title={t("playerProfile.attributes")}
            averageLabel={t("common.average")}
            hiddenTitle={t("playerProfile.attributesHidden")}
            hiddenBody={t("playerProfile.scoutToView")}
            listLabel={t("common.listView")}
            radarLabel={t("common.radarView")}
          />
        </>
      )}

      {view === "statistics" && <PlayerProfileSeasonStatsCard stats={player.stats} t={t} compact />}

      {view === "finances" && (
        <PlayerProfileContractCard
          dateOfBirth={player.date_of_birth}
          contractEnd={player.contract_end}
          currentDate={clockDate}
          condition={player.condition}
          morale={player.morale}
          marketValue={player.market_value}
          wage={player.wage}
          annualSuffix={t("finances.perYearSuffix")}
          language={i18n.language}
          contractRiskLevel={contractRisk}
          contractRiskLabel={
            contractRisk === "critical"
              ? t("finances.contractRiskCritical")
              : contractRisk === "warning"
                ? t("finances.contractRiskWarning")
                : t("finances.contractRiskStable")
          }
          isOwnClub
          hasLetExpireIntent={hasLetExpireIntent}
          actionSubmitting={contractSubmitting}
          onOpenRenewal={() => onSelectPlayer(player.id, { openRenewal: true })}
          onOpenTermination={() => onSelectPlayer(player.id, { openTermination: true })}
          onMarkLetExpire={onToggleContractExit}
          onClearLetExpire={onToggleContractExit}
          t={t}
        />
      )}
    </section>
  );
}
