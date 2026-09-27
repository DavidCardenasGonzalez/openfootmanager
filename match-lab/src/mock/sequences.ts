import type { Messages } from "../i18n";
import type { ReplayData } from "../match/types";
import { demoReplay } from "./demoReplay";
import { counterAttackReplay } from "./counterAttackReplay";

/** Add a ReplayData + translated title here to expose another sequence in the same player. */
export const sequences = {
  attackingGoal: { labelKey: "attackingGoalSequence", replay: demoReplay },
  counterAttackSave: { labelKey: "counterAttackSaveSequence", replay: counterAttackReplay },
} as const satisfies Record<string, { labelKey: keyof Messages; replay: ReplayData }>;
export type SequenceId = keyof typeof sequences;
