import { useTranslation } from "react-i18next";
import type { ObservedMatchStatsData } from "../../store/types";

interface ObservedMatchReportProps {
  stats: ObservedMatchStatsData;
  homeName: string;
  awayName: string;
}

const teamMetrics = [
  ["shots", "match.shots"],
  ["shots_on_target", "match.shotsOnTarget"],
  ["corners", "match.corners"],
  ["saves", "unityMatch.saves"],
] as const;

export default function ObservedMatchReport({ stats, homeName, awayName }: ObservedMatchReportProps) {
  const { t } = useTranslation();
  const { home, away, players } = stats;
  const rows = [
    ...(home.possession_pct != null && away.possession_pct != null
      ? [{ label: t("match.possession"), home: `${home.possession_pct}%`, away: `${away.possession_pct}%` }]
      : []),
    ...teamMetrics.map(([key, label]) => ({ label: t(label), home: home[key], away: away[key] })),
    {
      label: t("teamProfile.passes"),
      home: `${home.passes_completed}/${home.passes_attempted}`,
      away: `${away.passes_completed}/${away.passes_attempted}`,
    },
  ];

  return (
    <section aria-label={t("match.stats")} className="space-y-4 text-left text-sm">
      <table className="w-full table-fixed text-center tabular-nums">
        <thead className="border-b border-gray-200 text-primary-700 dark:border-navy-600 dark:text-primary-400">
          <tr>
            <th scope="col" className="pb-2">{homeName}</th>
            <th scope="col" className="pb-2 text-gray-600 dark:text-gray-300">{t("match.stats")}</th>
            <th scope="col" className="pb-2">{awayName}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-navy-700">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="py-1.5 font-semibold">{row.home}</td>
              <th scope="row" className="py-1.5 font-normal">{row.label}</th>
              <td className="py-1.5 font-semibold">{row.away}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Boolean(stats.incidents?.length) && (
        <details className="border-t border-gray-200 pt-3 dark:border-navy-600">
          <summary className="cursor-pointer font-semibold text-primary-700 dark:text-primary-400">
            {t("match.keyEvents")}
          </summary>
          <ol className="mt-2 divide-y divide-gray-100 dark:divide-navy-700">
            {stats.incidents?.map((incident, index) => {
              const { kind, minute, player_id, player_name, side } = incident;
              const label = kind === "ThrowIn" || kind === "Offside"
                ? t(`unityMatch.${kind}`)
                : t(`match.eventTypes.${kind}`);
              return (
                <li key={`${minute}-${kind}-${player_id}-${index}`} className="flex flex-wrap gap-x-2 py-1.5">
                  <span className="w-9 tabular-nums">{minute}′</span>
                  <span className="font-semibold">{label}</span>
                  <span>{player_name || player_id} ({side === "Home" ? homeName : awayName})</span>
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {players.length > 0 && (
        <details className="border-t border-gray-200 pt-3 dark:border-navy-600">
          <summary className="cursor-pointer font-semibold text-primary-700 dark:text-primary-400">
            {t("unityMatch.playerStats")}
          </summary>
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            {([["Home", homeName], ["Away", awayName]] as const).map(([side, name]) => {
              const lineup = players.filter((player) => player.side === side);
              if (!lineup.length) return null;
              return (
                <div className="overflow-x-auto" key={side}>
                  <table className="w-full min-w-max text-center tabular-nums">
                    <caption className="pb-2 text-left font-semibold">{name}</caption>
                    <thead className="border-b border-gray-200 text-xs dark:border-navy-600">
                      <tr>
                        <th scope="col" className="p-2 text-left">{t("common.player")}</th>
                        <th scope="col" className="p-2">{t("unityMatch.minutes")}</th>
                        <th scope="col" className="p-2">{t("match.shots")}</th>
                        <th scope="col" className="p-2">{t("match.shotsOnTarget")}</th>
                        <th scope="col" className="p-2">{t("teamProfile.passes")}</th>
                        <th scope="col" className="p-2">{t("unityMatch.saves")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-navy-700">
                      {lineup.map((player) => (
                        <tr key={player.player_id}>
                          <th scope="row" className="p-2 text-left font-medium">{player.player_name || player.player_id}</th>
                          <td>{player.minutes_played}′</td>
                          <td>{player.shots}</td>
                          <td>{player.shots_on_target}</td>
                          <td>{player.passes_completed}/{player.passes_attempted}</td>
                          <td>{player.saves}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
