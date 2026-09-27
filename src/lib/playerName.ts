type PlayerNameData = {
  match_name?: string | null;
  full_name: string;
  media?: { source_data?: Record<string, unknown>; face?: string | null };
};

/** Prefer the authored provider shortName, then the game's legacy match_name. */
export function getPlayerDisplayName(player: PlayerNameData): string {
  const sourceData = player.media?.source_data;
  const sourceShortName = sourceData?.shortName ?? sourceData?.short_name;
  if (typeof sourceShortName === "string" && sourceShortName.trim()) {
    return sourceShortName.trim();
  }
  return player.match_name || player.full_name;
}
