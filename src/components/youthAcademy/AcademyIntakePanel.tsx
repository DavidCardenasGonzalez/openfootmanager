import { useTranslation } from "react-i18next";
import type { AcademyView } from "../../services/academyService";
import { formatExactMoney } from "../../lib/helpers";
import { formatDate } from "../../lib/dateFormatting";
import { translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { Button, Card, CardBody, CardHeader, Badge } from "../ui";

interface Props {
  intake: AcademyView;
  pending: string | null;
  error: string | null;
  onSign: (id: string) => void;
  onReject: (id: string) => void;
  onUpgrade: () => void;
}

export default function AcademyIntakePanel({
  intake,
  pending,
  error,
  onSign,
  onReject,
  onUpgrade,
}: Props) {
  const { t } = useTranslation();
  const full = intake.roster_size >= intake.roster_limit;
  return (
    <Card accent="primary">
      <CardHeader>{t("academy.title")}</CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant="primary">{t("academy.level", { level: intake.level })}</Badge>
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== null || !intake.upgrade_available}
            onClick={onUpgrade}
          >
            {intake.level >= 5
              ? t("academy.maxLevel")
              : t("academy.upgrade", { cost: formatExactMoney(intake.upgrade_cost) })}
          </Button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("academy.description")}</p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("academy.capacity", {
            remaining: intake.signings_remaining,
            limit: intake.signing_limit,
            squad: intake.roster_size,
            maximum: intake.roster_limit,
          })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("academy.deadline", { date: formatDate(intake.expires_on) })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("academy.nextGeneration", {
            candidates: intake.next_candidates,
            signings: intake.next_signings,
          })}{" "}
          {t("academy.upgradeHint")}
        </p>
        {full && (
          <p className="text-sm text-accent-700 dark:text-accent-400">{t("academy.rosterError")}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {intake.candidates.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("academy.empty")}</p>
        ) : (
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {intake.candidates.map((candidate) => (
              <li
                key={candidate.id}
                className="rounded-xl border border-gray-200 dark:border-navy-600 bg-gray-50 dark:bg-navy-800 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-heading font-bold text-gray-900 dark:text-gray-100">
                    {candidate.full_name}
                  </h3>
                  <Badge variant="neutral">
                    {translatePositionAbbreviation(t, candidate.position)}
                  </Badge>
                </div>
                <dl className="flex flex-wrap gap-5 text-sm text-gray-700 dark:text-gray-300">
                  <div>
                    <dt>{t("youthAcademy.ovr")}</dt>
                    <dd className="font-bold">{candidate.ovr}</dd>
                  </div>
                  <div>
                    <dt>{t("academy.potentialEstimate")}</dt>
                    <dd className="font-bold">
                      {candidate.potential_low}–{candidate.potential_high}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("academy.costs", {
                    fee: formatExactMoney(candidate.signing_fee),
                    wage: formatExactMoney(candidate.annual_wage),
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending !== null || full || intake.signings_remaining === 0}
                    onClick={() => onSign(candidate.id)}
                  >
                    {t("academy.sign")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => onReject(candidate.id)}
                  >
                    {t("academy.reject")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
