import { invoke } from "@tauri-apps/api/core";

import type { MatchSnapshot } from "../components/match/types";

export function autoSelectPreMatchLineup(side: "Home" | "Away"): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("auto_select_pre_match_lineup", { side });
}
