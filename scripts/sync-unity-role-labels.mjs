import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const directory = new URL("../src/i18n/locales/", import.meta.url);
const destination = new URL("../integrations/unity/Resources/OpenFootRoleLabels.json", import.meta.url);
const locales = readdirSync(directory).filter(file => file.endsWith(".json")).sort().map(file => {
  const strings = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
  return {
    code: file.slice(0, -5),
    heading: strings.match.playerRoles,
    roles: Object.entries(strings.tactics.playerRoles).map(([id, text]) => ({ id, text })),
    tactics: Object.entries({
      ...strings.tactics.phaseSettings,
      ...strings.tactics.phaseLabels,
      phaseBlueprint: strings.tactics.phaseBlueprint,
      Possession: strings.common.playStyles.Possession,
      selectForSwap: strings.match.selectForSwap,
      ThrowIn: strings.unityMatch.ThrowIn,
      Offside: strings.unityMatch.Offside,
      ExtraTimeFirstHalf: strings.match.phases.ExtraTimeFirstHalf,
      ExtraTimeSecondHalf: strings.match.phases.ExtraTimeSecondHalf,
      PenaltyShootout: strings.match.penaltyShootout,
      ...Object.fromEntries(["Foul", "YellowCard", "SecondYellow", "RedCard", "PenaltyAwarded", "PenaltyGoal", "PenaltyMiss"]
        .map(kind => [kind, strings.match.eventTypes[kind]])),
    }).map(([id, text]) => ({ id, text })),
  };
});
writeFileSync(destination, JSON.stringify({ locales }) + "\n");
