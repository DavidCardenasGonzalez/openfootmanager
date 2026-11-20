import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import MatchSimulation from "./MatchSimulation";

const navigateMock = vi.fn();
const setGameStateMock = vi.fn();
let locationState: unknown = null;
let gameStoreState: {
  gameState: Record<string, unknown> | null;
  setGameState: typeof setGameStateMock;
  setGameActive?: ReturnType<typeof vi.fn>;
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ state: locationState }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
    i18n: { language: "en" },
  }),
}));

function translate(key: string, options?: string | { defaultValue?: string; minute?: number; name?: string }) {
  if (typeof options === "string") return options;
  if (options?.minute !== undefined) return `${key} ${options.minute}`;
  if (options?.name !== undefined) return `${key} ${options.name}`;
  return options?.defaultValue ?? key;
}

vi.mock("../store/gameStore", () => ({
  useGameStore: () => gameStoreState,
}));

vi.mock("../lib/extraTranslations", () => ({
  applyExtraTranslations: vi.fn(),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: () => ({
    settings: { match_speed: "normal", auto_save_after_match: true },
  }),
}));

vi.mock("../components/match/PreMatchSetup", () => ({
  default: ({
    snapshot,
    onStart,
    onUnityStart,
  }: {
    snapshot: { home_team: { name: string } };
    onStart?: () => void;
    onUnityStart?: () => void;
  }) => (
    <div data-testid="prematch">
      {snapshot.home_team.name}
      <button onClick={onUnityStart}>Unity 3D</button>
      <button type="button" data-testid="prematch-start" onClick={onStart}>
        Start
      </button>
    </div>
  ),
}));

vi.mock("../components/match/MatchLive", () => ({
  default: ({
    snapshot,
    preferredSpeed,
    onPreferredSpeedChange,
    onHalfTime,
    onFullTime,
  }: {
    snapshot: { home_team: { name: string } };
    preferredSpeed?: string;
    onPreferredSpeedChange?: (speed: string) => void;
    onHalfTime?: () => void;
    onFullTime?: () => void;
  }) => (
    <div data-testid="match-live-container" data-preferred-speed={preferredSpeed ?? "normal"}>
      {snapshot.home_team.name}
      <button type="button" data-testid="match-live" onClick={onFullTime}>
        Full Time
      </button>
      <button type="button" data-testid="match-trigger-halftime" onClick={onHalfTime}>
        Half Time
      </button>
      <button
        type="button"
        data-testid="match-trigger-speed-fast"
        onClick={() => onPreferredSpeedChange?.("fast")}
      >
        Fast
      </button>
    </div>
  ),
}));

vi.mock("../components/match/HalfTimeBreak", () => ({
  default: ({ onResume }: { onResume?: () => void }) => (
    <div data-testid="halftime">
      <button type="button" data-testid="halftime-resume" onClick={onResume}>
        Resume
      </button>
    </div>
  ),
}));

vi.mock("../components/match/PostMatchScreen", () => ({
  default: ({ onContinue, onFinish }: { onContinue?: () => void; onFinish?: () => void }) => (
    <div>
      <button type="button" data-testid="postmatch-continue" onClick={onContinue}>
        Continue
      </button>
      <button type="button" data-testid="postmatch-finish" onClick={onFinish}>
        Finish Match
      </button>
    </div>
  ),
}));

vi.mock("../components/match/RoundDigestScreen", () => ({
  default: ({
    snapshot,
    roundSummary,
    isLeagueFixture,
    onPressConference,
    onFinish,
  }: {
    snapshot: { home_score: number; away_score: number };
    roundSummary?: unknown;
    isLeagueFixture?: boolean;
    onPressConference?: () => void;
    onFinish?: () => void;
  }) => (
    <div>
      <span data-testid="digest-score">{snapshot.home_score}-{snapshot.away_score}</span>
      <div data-testid="digest-round-summary">
        {roundSummary ? JSON.stringify(roundSummary) : "null"}
      </div>
      <div data-testid="digest-is-league">{isLeagueFixture ? "true" : "false"}</div>
      <button type="button" data-testid="digest-press" onClick={onPressConference}>
        Press Conference
      </button>
      <button type="button" data-testid="digest-finish" onClick={onFinish}>
        Skip
      </button>
    </div>
  ),
}));

vi.mock("../components/match/PressConference", () => ({
  default: () => <div data-testid="press" />,
}));

const mockedInvoke = vi.mocked(invoke);

function makeEnginePlayer(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "p1",
    name: "Player One",
    position: "Goalkeeper",
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
    traits: [],
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    phase: "PreKickOff",
    current_minute: 0,
    home_score: 0,
    away_score: 0,
    possession: "Home",
    ball_zone: "Midfield",
    home_team: {
      id: "home1",
      name: "Home FC",
      formation: "4-4-2",
      play_style: "Balanced",
      players: [makeEnginePlayer({ id: "home-p1", name: "Home Keeper" })],
    },
    away_team: {
      id: "away1",
      name: "Away FC",
      formation: "4-4-2",
      play_style: "Balanced",
      players: [makeEnginePlayer({ id: "away-p1", name: "Away Keeper" })],
    },
    home_bench: [],
    away_bench: [],
    home_possession_pct: 50,
    away_possession_pct: 50,
    events: [],
    home_subs_made: 0,
    away_subs_made: 0,
    max_subs: 5,
    home_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    away_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    substitutions: [],
    allows_extra_time: false,
    home_yellows: {},
    away_yellows: {},
    sent_off: [],
    ...overrides,
  };
}

function makeGameState(): Record<string, unknown> {
  return {
    clock: {
      current_date: "2026-08-01",
      start_date: "2026-08-01",
    },
    manager: {
      id: "mgr1",
      first_name: "Test",
      last_name: "Manager",
      date_of_birth: "1980-01-01",
      nationality: "GB",
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: "home1",
      career_stats: {
        matches_managed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        trophies: 0,
        best_finish: null,
      },
      career_history: [],
    },
    teams: [
      {
        id: "home1",
        name: "Home FC",
        short_name: "HOM",
        country: "England",
        city: "Home City",
        stadium_name: "Home Ground",
        stadium_capacity: 20000,
        finance: 1000000,
        manager_id: "mgr1",
        reputation: 50,
        wage_budget: 100000,
        transfer_budget: 500000,
        season_income: 0,
        season_expenses: 0,
        formation: "4-4-2",
        play_style: "Balanced",
        training_focus: "General",
        training_intensity: "Balanced",
        training_schedule: "Balanced",
        founded_year: 1900,
        colors: { primary: "#00ff00", secondary: "#ffffff" },
        starting_xi_ids: [],
        form: [],
        history: [],
      },
      {
        id: "away1",
        name: "Away FC",
        short_name: "AWY",
        country: "England",
        city: "Away City",
        stadium_name: "Away Ground",
        stadium_capacity: 20000,
        finance: 1000000,
        manager_id: null,
        reputation: 50,
        wage_budget: 100000,
        transfer_budget: 500000,
        season_income: 0,
        season_expenses: 0,
        formation: "4-4-2",
        play_style: "Balanced",
        training_focus: "General",
        training_intensity: "Balanced",
        training_schedule: "Balanced",
        founded_year: 1900,
        colors: { primary: "#0000ff", secondary: "#ffffff" },
        starting_xi_ids: [],
        form: [],
        history: [],
      },
    ],
    players: [],
    staff: [],
    messages: [],
    news: [],
    league: null,
    scouting_assignments: [],
    board_objectives: [],
  };
}

function makeGameStateWithFriendly() {
  const base = makeGameState();
  return {
    ...base,
    league: {
      id: "league1",
      name: "Test League",
      fixtures: [
        {
          id: "fix1",
          competition: "Friendly",
          home_team_id: "home1",
          away_team_id: "away1",
          date: "2026-08-01",
          status: "Scheduled",
          result: null,
          round: 1,
          matchday: null,
        },
      ],
      standings: [],
      top_scorers: [],
    },
  };
}

describe("MatchSimulation", (): void => {
  beforeEach(function resetState(): void {
    mockedInvoke.mockReset();
    navigateMock.mockReset();
    setGameStateMock.mockReset();
    locationState = null;
    gameStoreState = {
      gameState: makeGameState(),
      setGameState: setGameStateMock,
    };
  });

  it("shows the imported Unity score in the digest and saves it once", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_match_snapshot") return makeSnapshot();
      if (command === "export_unity_match") return "test.request.json";
      if (command === "finish_unity_match") {
        return { game: makeGameState(), home_goals: 3, away_goals: 2 };
      }
      if (command === "save_game") return;
      throw new Error(command);
    });
    render(<MatchSimulation />);
    fireEvent.click(await screen.findByText("Unity 3D"));
    fireEvent.click(await screen.findByText("unityMatch.import"));
    expect((await screen.findByTestId("digest-score")).textContent).toBe("3-2");
    expect(mockedInvoke.mock.calls.filter(([name]) => name === "save_game")).toHaveLength(1);
    expect(mockedInvoke).not.toHaveBeenCalledWith("finish_live_match");
  });

  it("restores the active career when the match route reloads", async () => {
    const restored = makeGameState();
    gameStoreState.gameState = null;
    gameStoreState.setGameActive = vi.fn();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_active_game") return restored;
      if (command === "get_match_snapshot") return makeSnapshot();
      throw new Error(command);
    });

    render(<MatchSimulation />);

    await waitFor(() => expect(setGameStateMock).toHaveBeenCalledWith(restored));
    expect(gameStoreState.setGameActive).toHaveBeenCalledWith(true, "Test Manager");
  });

  it("applies an embedded match at full time without a manual import", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_match_snapshot") return makeSnapshot();
      if (command === "export_unity_match") return "test.request.json";
      if (command === "start_unity_player") return true;
      if (command === "update_unity_player") return { finished: true };
      if (command === "finish_unity_match") {
        return { game: makeGameState(), home_goals: 1, away_goals: 2 };
      }
      if (command === "save_game" || command === "stop_unity_player") return;
      throw new Error(command);
    });

    render(<MatchSimulation />);
    fireEvent.click(await screen.findByText("Unity 3D"));

    expect((await screen.findByTestId("digest-score")).textContent).toBe("1-2");
    expect(mockedInvoke).toHaveBeenCalledWith("save_game");
    expect(mockedInvoke).toHaveBeenCalledWith("stop_unity_player");
  });

  it("waits for Unity to confirm the live tactic and its minute", async () => {
    let tactics: Record<string, unknown> = { ready: true, pending: false, applied: null };
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_match_snapshot") return makeSnapshot();
      if (command === "export_unity_match") return "test.request.json";
      if (command === "start_unity_player") return true;
      if (command === "update_unity_player") return { finished: false, tactics };
      if (command === "set_unity_play_style") {
        tactics = { ready: true, pending: true, applied: null };
        return tactics;
      }
      if (command === "stop_unity_player") return;
      throw new Error(command);
    });

    render(<MatchSimulation />);
    fireEvent.click(await screen.findByText("Unity 3D"));
    const select = await screen.findByRole("combobox", { name: "tactics.playStyle" });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: "HighPress" } });
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith(
      "set_unity_play_style", { playStyle: "HighPress" },
    ));
    expect(await screen.findByText("unityMatch.tacticPending")).toBeInTheDocument();
    expect(select).toBeDisabled();
    expect(select).toHaveValue("Balanced");

    tactics = { ready: true, pending: false, applied: { play_style: "HighPress", minute: 60 } };
    expect(await screen.findByText("unityMatch.tacticApplied 60")).toBeInTheDocument();
    expect(select).toBeEnabled();
    expect(select).toHaveValue("HighPress");
  });

  it("updates the Unity lineup only after the substitution is confirmed", async () => {
    const starter = makeEnginePlayer({ id: "starter", name: "Starter", position: "Forward" });
    const reserve = makeEnginePlayer({ id: "reserve", name: "Reserve", position: "Forward" });
    const keeper = makeEnginePlayer({ id: "keeper", name: "Keeper", position: "Goalkeeper" });
    const snapshot = makeSnapshot({
      home_bench: [reserve, keeper],
      home_team: { id: "home1", name: "Home FC", formation: "4-4-2", play_style: "Balanced", players: [starter] },
    });
    let tactics: Record<string, unknown> = { ready: true, pending: false, substitutions_ready: true };
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_match_snapshot") return snapshot;
      if (command === "export_unity_match") return "test.request.json";
      if (command === "start_unity_player") return true;
      if (command === "update_unity_player") return { finished: false, tactics };
      if (command === "substitute_unity_player") {
        tactics = { ready: true, pending: true, pending_substitution: true, substitutions_ready: true };
        return tactics;
      }
      if (command === "stop_unity_player") return;
      throw new Error(command);
    });
    render(<MatchSimulation />);
    fireEvent.click(await screen.findByText("Unity 3D"));
    const out = await screen.findByRole("combobox", { name: "match.selectPlayerOff" });
    const incoming = screen.getByRole("combobox", { name: "match.selectReplacement" });
    await waitFor(() => expect(out).toBeEnabled());
    fireEvent.change(out, { target: { value: "starter" } });
    expect(screen.queryByRole("option", { name: "Keeper" })).not.toBeInTheDocument();
    fireEvent.change(incoming, { target: { value: "reserve" } });
    fireEvent.click(screen.getByRole("button", { name: "match.makeSubstitution" }));
    expect(await screen.findByText("unityMatch.subPending")).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith("substitute_unity_player", {
      playerOffId: "starter", playerOnId: "reserve",
    });
    expect(screen.getByRole("option", { name: "Starter" })).toBeInTheDocument();
    tactics = {
      ready: true, pending: false, substitutions_ready: true,
      substitutions: [{ player_off_id: "starter", player_on_id: "reserve", minute: 52 }],
    };
    expect(await screen.findByText("52′ Reserve match.subFor Starter")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Starter" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Reserve" })).toBeInTheDocument();
  });

  it("hides the manager substitute selects when the Unity panel is available", async () => {
    const starter = makeEnginePlayer({ id: "starter", name: "Starter", position: "Forward" });
    const reserve = makeEnginePlayer({ id: "reserve", name: "Reserve", position: "Forward" });
    const snapshot = makeSnapshot({
      home_bench: [reserve],
      home_team: { id: "home1", name: "Home FC", formation: "4-4-2", play_style: "Balanced", players: [starter] },
    });
    let tactics: Record<string, unknown> = { ready: true, pending: false, substitutions_ready: true };
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_match_snapshot") return snapshot;
      if (command === "export_unity_match") return "test.request.json";
      if (command === "start_unity_player") return true;
      if (command === "update_unity_player") return { finished: false, tactics };
      if (command === "stop_unity_player") return;
      throw new Error(command);
    });
    render(<MatchSimulation />);
    fireEvent.click(await screen.findByText("Unity 3D"));
    const select = await screen.findByRole("combobox", { name: "match.selectPlayerOff" });
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "tactics.playStyle" })).toBeInTheDocument();
    tactics = { ready: true, pending: false, substitutions_ready: true, substitutions_panel: true };
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "match.selectPlayerOff" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "match.makeSubstitution" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "tactics.playStyle" })).not.toBeInTheDocument();
  });

  it("renders the current live snapshot when get_match_snapshot succeeds", async (): Promise<void> => {
    mockedInvoke.mockResolvedValueOnce(makeSnapshot());

    render(<MatchSimulation />);

    await waitFor((): void => {
      expect(mockedInvoke).toHaveBeenCalledWith("get_match_snapshot");
    });

    await waitFor((): void => {
      expect(screen.getByTestId("prematch")).toHaveTextContent("Home FC");
    });
  });

  it("restores the live match session when no snapshot exists but fixture index is provided", async (): Promise<void> => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      locationState = {
        fixtureIndex: 4,
        mode: "live",
        snapshot: makeSnapshot({
          home_team: {
            id: "home1",
            name: "Boot Snapshot FC",
            formation: "4-4-2",
            play_style: "Balanced",
            players: [makeEnginePlayer({ id: "boot-p1", name: "Boot Keeper" })],
          },
        }),
      };

      mockedInvoke.mockRejectedValueOnce(new Error("No active live match"));
      mockedInvoke.mockResolvedValueOnce(
        makeSnapshot({
          home_team: {
            id: "home1",
            name: "Restored FC",
            formation: "4-4-2",
            play_style: "Balanced",
            players: [makeEnginePlayer({ id: "restore-p1", name: "Restore Keeper" })],
          },
        }),
      );

      render(<MatchSimulation />);

      await waitFor((): void => {
        expect(mockedInvoke).toHaveBeenCalledWith("start_live_match", {
          allowsExtraTime: false,
          fixtureIndex: 4,
          mode: "live",
          homeTeamId: "home1",
          awayTeamId: "away1",
        });
      });

      expect(screen.getByTestId("prematch")).toHaveTextContent("Restored FC");
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("moves spectators straight into the live match stage", async (): Promise<void> => {
    locationState = {
      mode: "spectator",
      snapshot: makeSnapshot(),
    };

    mockedInvoke.mockResolvedValueOnce(makeSnapshot());

    render(<MatchSimulation />);

    await waitFor((): void => {
      expect(screen.getByTestId("match-live-container")).toHaveTextContent("Home FC");
    });
  });

  it("navigates away from postmatch after the finalized game has been stored", async (): Promise<void> => {
    locationState = {
      mode: "spectator",
      snapshot: makeSnapshot(),
    };

    const finishedGame = makeGameState();
    mockedInvoke.mockResolvedValueOnce(makeSnapshot()).mockResolvedValueOnce({
      game: finishedGame,
      round_summary: {
        matchday: 1,
        is_complete: true,
        pending_fixture_count: 0,
        completed_results: [],
        standings_delta: [],
        notable_upset: null,
        top_scorer_delta: [],
      },
    });

    render(<MatchSimulation />);

    await waitFor((): void => {
      expect(screen.getByTestId("match-live-container")).toHaveTextContent("Home FC");
    });

    fireEvent.click(screen.getByTestId("match-live"));

    await waitFor((): void => {
      expect(mockedInvoke).toHaveBeenCalledWith("finish_live_match");
      expect(mockedInvoke).toHaveBeenCalledWith("save_game");
      expect(screen.getByTestId("postmatch-finish")).toBeInTheDocument();
    });

    expect(setGameStateMock).toHaveBeenCalledWith(finishedGame);

    fireEvent.click(screen.getByTestId("postmatch-finish"));

    await waitFor((): void => {
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("finalizes the match on full time and passes the round summary into the digest screen", async (): Promise<void> => {
    locationState = {
      mode: "live",
      snapshot: makeSnapshot(),
    };

    const finishedGame = makeGameState();
    const roundSummary = {
      matchday: 1,
      is_complete: true,
      pending_fixture_count: 0,
      completed_results: [],
      standings_delta: [],
      notable_upset: null,
      top_scorer_delta: [],
    };
    mockedInvoke.mockResolvedValueOnce(makeSnapshot()).mockResolvedValueOnce({
      game: finishedGame,
      round_summary: roundSummary,
    });

    render(<MatchSimulation />);

    // Manager sees prematch; advance to live match
    await waitFor((): void => {
      expect(screen.getByTestId("prematch-start")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("prematch-start"));

    await waitFor((): void => {
      expect(screen.getByTestId("match-live-container")).toHaveTextContent("Home FC");
    });

    fireEvent.click(screen.getByTestId("match-live"));

    await waitFor((): void => {
      expect(mockedInvoke).toHaveBeenCalledWith("finish_live_match");
      expect(mockedInvoke).toHaveBeenCalledWith("save_game");
      expect(screen.getByTestId("postmatch-finish")).toBeInTheDocument();
    });

    expect(setGameStateMock).toHaveBeenCalledWith(finishedGame);

    // Manager clicks Continue → goes to digest
    fireEvent.click(screen.getByTestId("postmatch-continue"));

    await waitFor((): void => {
      expect(screen.getByTestId("digest-round-summary")).toBeInTheDocument();
    });

    expect(screen.getByTestId("digest-round-summary")).toHaveTextContent('"matchday":1');

    fireEvent.click(screen.getByTestId("digest-finish"));

    await waitFor((): void => {
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("routes a manager's friendly through digest with isLeagueFixture=false", async (): Promise<void> => {
    locationState = {
      mode: "live",
      fixtureIndex: 0,
      snapshot: makeSnapshot(),
    };

    gameStoreState = {
      gameState: makeGameStateWithFriendly(),
      setGameState: setGameStateMock,
    };

    mockedInvoke.mockResolvedValueOnce(makeSnapshot()).mockResolvedValueOnce({
      game: makeGameState(),
      round_summary: null,
    });

    render(<MatchSimulation />);

    // Manager sees prematch; click Start to advance to first_half
    await waitFor((): void => {
      expect(screen.getByTestId("prematch-start")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("prematch-start"));

    await waitFor((): void => {
      expect(screen.getByTestId("match-live")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("match-live"));

    await waitFor((): void => {
      expect(screen.getByTestId("postmatch-continue")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("postmatch-continue"));

    await waitFor((): void => {
      expect(screen.getByTestId("digest-is-league")).toHaveTextContent("false");
    });
  });

  it("preserves user-selected match speed from first half into second half", async (): Promise<void> => {
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockResolvedValueOnce(makeSnapshot());

    render(<MatchSimulation />);

    // Advance to the first-half live match view.
    await waitFor((): void => {
      expect(screen.getByTestId("prematch-start")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("prematch-start"));

    await waitFor((): void => {
      expect(screen.getByTestId("match-live-container")).toBeInTheDocument();
    });

    // Initial preferred speed comes from settings ("normal").
    expect(screen.getByTestId("match-live-container")).toHaveAttribute(
      "data-preferred-speed",
      "normal",
    );

    // User selects fast speed during first half.
    fireEvent.click(screen.getByTestId("match-trigger-speed-fast"));

    // Trigger half-time transition.
    fireEvent.click(screen.getByTestId("match-trigger-halftime"));

    await waitFor((): void => {
      expect(screen.getByTestId("halftime")).toBeInTheDocument();
    });

    // Resume from half-time — advances to second_half stage.
    fireEvent.click(screen.getByTestId("halftime-resume"));

    // The remounted MatchLive for second half must carry the user's preferred speed.
    await waitFor((): void => {
      expect(screen.getByTestId("match-live-container")).toHaveAttribute(
        "data-preferred-speed",
        "fast",
      );
    });
  });
});
