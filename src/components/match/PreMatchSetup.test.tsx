import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import PreMatchSetup from "./PreMatchSetup";
import type { GameStateData } from "../../store/gameStore";
import type { MatchSnapshot } from "./types";

// Mock the few external dependencies PreMatchSetup pulls in at render time so we
// can exercise the real component tree (the opponent scout panel in particular).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (typeof opts === "string") return opts;
      if (opts && typeof opts === "object" && "defaultValue" in opts) {
        return (opts as { defaultValue: string }).defaultValue;
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));
vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}));

function enginePlayer(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "p",
    name: "Player",
    position: "Midfielder",
    condition: 100,
    pace: 50,
    stamina: 50,
    strength: 50,
    agility: 50,
    passing: 50,
    shooting: 50,
    tackling: 50,
    dribbling: 50,
    defending: 50,
    positioning: 50,
    vision: 50,
    decisions: 50,
    composure: 50,
    aggression: 50,
    teamwork: 50,
    leadership: 50,
    handling: 50,
    reflexes: 50,
    aerial: 50,
    ovr: 60,
    traits: [],
    ...over,
  };
}

const homePlayers = [
  enginePlayer({ id: "h-gk", name: "Home GK", position: "Goalkeeper" }),
  enginePlayer({ id: "h-df", name: "Home Def", position: "Defender" }),
  enginePlayer({ id: "h-mf", name: "Home Mid", position: "Midfielder" }),
  enginePlayer({ id: "h-fw", name: "Home Fwd", position: "Forward" }),
];
const awayPlayers = [
  enginePlayer({ id: "a-gk", name: "Away GK", position: "Goalkeeper" }),
  enginePlayer({ id: "a-fw", name: "Away Fwd", position: "Forward" }),
];

const emptySetPieces = {
  free_kick_taker: null,
  corner_taker: null,
  penalty_taker: null,
  captain: null,
};

function snapshot(): Record<string, unknown> {
  return {
    home_team: {
      id: "home1",
      name: "Home FC",
      formation: "4-4-2",
      play_style: "Balanced",
      players: homePlayers,
    },
    away_team: {
      id: "away1",
      name: "Away FC",
      formation: "4-3-3", // distinct from home, so it only appears in the opponent panel
      play_style: "Counter",
      players: awayPlayers,
    },
    home_bench: [],
    away_bench: [],
    home_set_pieces: emptySetPieces,
    away_set_pieces: emptySetPieces,
  };
}

function gameState(): Record<string, unknown> {
  return {
    clock: { current_date: "2026-08-01" },
    players: [],
    teams: [
      {
        id: "home1",
        name: "Home FC",
        short_name: "HOM",
        colors: { primary: "#10b981", secondary: "#1a3a6b" },
      },
      {
        id: "away1",
        name: "Away FC",
        short_name: "AWY",
        colors: { primary: "#6366f1", secondary: "#1a3a6b" },
      },
    ],
  };
}

function renderSetup() {
  return render(
    <PreMatchSetup
      // The two fixtures build partial objects deliberately — this test exercises the setup
      // screen, not the full match snapshot — so the cast is the honest spelling of "stands in
      // for". It goes through `unknown` because the shapes genuinely do not overlap, and the
      // two `eslint-disable` lines it used to carry were decorative: there is no ESLint here.
      snapshot={snapshot() as unknown as MatchSnapshot}
      gameState={gameState() as unknown as GameStateData}
      userSide="Home"
      onStart={vi.fn()}
      onUnityStart={vi.fn()}
      onUpdateSnapshot={vi.fn()}
    />,
  );
}

describe("PreMatchSetup opponent scout panel", () => {
  it("scouts the opponent squad on the Opponent tab", () => {
    renderSetup();

    // Default "Your Team" view: opponent players are not listed.
    expect(screen.queryByText("Away Fwd")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /match\.opponent.*AWY/ }));

    // The opponent scout panel lists the opponent's players by name.
    expect(screen.getByText("Away GK")).toBeTruthy();
    expect(screen.getByText("Away Fwd")).toBeTruthy();
  });
});

it("waits for a role change to reach the match before enabling kickoff", async () => {
  let complete = () => {};
  vi.mocked(invoke).mockReturnValueOnce(new Promise<void>((resolve) => { complete = resolve; }));
  renderSetup();
  fireEvent.click(screen.getByRole("combobox", { name: /match\.playerRoles.*Home GK/ }));
  fireEvent.click(screen.getByRole("option", { name: "SweeperKeeper" }));
  const unity = screen.getByRole<HTMLButtonElement>("button", { name: /match\.startMatch/ });
  expect(unity.disabled).toBe(true);
  await act(async () => complete());
  expect(unity.disabled).toBe(false);
});

it("waits for a team tactic to reach the match before enabling kickoff", async () => {
  let complete = () => {};
  vi.mocked(invoke).mockReturnValueOnce(new Promise<Record<string, unknown>>((resolve) => {
    complete = () => resolve(gameState());
  }));
  renderSetup();
  fireEvent.click(screen.getByRole("combobox", { name: "tactics.phaseSettings.width" }));
  fireEvent.click(screen.getByRole("option", { name: "Wide" }));
  expect(invoke).toHaveBeenCalledWith("set_tactics_phase", expect.objectContaining({ width: "Wide" }));
  const kickoff = screen.getByRole<HTMLButtonElement>("button", { name: /match\.startMatch/ });
  expect(kickoff.disabled).toBe(true);
  await act(async () => complete());
  expect(kickoff.disabled).toBe(false);
});

it.each([false, true])("starts in Unity from kickoff when extra time is %s", (extraTime) => {
  const start = vi.fn();
  const unityStart = vi.fn();
  render(<PreMatchSetup snapshot={{ ...snapshot(), allows_extra_time: extraTime } as unknown as MatchSnapshot} gameState={gameState() as unknown as GameStateData} userSide="Home" onStart={start} onUnityStart={unityStart} onUpdateSnapshot={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /match\.startMatch/ }));
  expect(unityStart).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Unity 3D/ })).toBeNull();
});
