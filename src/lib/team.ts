import type { TeamData } from "../store/gameStore";

export function getTeamName(teams: TeamData[], id: string | null): string {
  if (!id) {
    return "Free Agent";
  }
  const team = teams.find((item) => item.id === id);
  return team?.short_name || team?.name || "Unknown";
}

export function getTeamShort(teams: TeamData[], id: string): string {
  return teams.find((team) => team.id === id)?.short_name ?? "???";
}
