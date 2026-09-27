import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import MatchLive from "./MatchLive";
import type { EnginePlayerData, EngineTeamData, MatchSnapshot } from "./types";
import type { GameStateData } from "../../store/gameStore";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ settings: { match_speed: "normal" } }),
}));
vi.mock("./LiveMatchView", () => ({
  LiveMatchView: () => <div role="img" aria-label="live pitch" />,
}));
vi.mock("../ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TeamLogo: () => null,
  ThemeToggle: () => null,
}));
const makePlayer = (overrides: Partial<EnginePlayerData> = {}): EnginePlayerData => {
  const { ovr = 70, ...rest } = overrides;

  return {
    id: "player-1",
    name: "Player One",
    position: "Midfielder",
    ovr,
    condition: 78,
    pace: 70,
    stamina: 70,
    strength: 70,
    agility: 70,
    passing: 70,
    shooting: 70,
    tackling: 70,
    dribbling: 70,
    defending: 70,
    positioning: 70,
    vision: 70,
    decisions: 70,
    composure: 70,
    aggression: 60,
    teamwork: 70,
    leadership: 60,
    handling: 20,
    reflexes: 20,
    aerial: 60,
    traits: [],
    role: "Standard",
    ...rest,
  };
};

const makeTeam = (overrides: Partial<EngineTeamData> = {}): EngineTeamData => ({
  id: "team-1",
  name: "Alpha FC",
  formation: "4-4-2",
  play_style: "Balanced",
  players: [
    makePlayer({ id: "starter-1", name: "Starter One", position: "Midfielder" }),
    makePlayer({ id: "starter-2", name: "Starter Two", position: "Forward", shooting: 80 }),
  ],
  ...overrides,
});

function createSnapshot(): MatchSnapshot {
  return {
    phase: "first_half",
    current_minute: 32,
    home_score: 1,
    away_score: 0,
    possession: "Home",
    ball_zone: "MiddleThird",
    home_team: makeTeam(),
    away_team: makeTeam({
      id: "team-2",
      name: "Beta FC",
      players: [makePlayer({ id: "opp-1", name: "Opponent One" })],
    }),
    home_bench: [
      makePlayer({ id: "bench-1", name: "Bench One", position: "Midfielder", condition: 92 }),
      makePlayer({ id: "bench-2", name: "Bench Two", position: "Forward", shooting: 76 }),
    ],
    away_bench: [makePlayer({ id: "opp-bench-1", name: "Opponent Bench" })],
    home_possession_pct: 56,
    away_possession_pct: 44,
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
  };
}

describe("MatchLive presentation", () => {
  it("opens the pitch by default and keeps events and other panels accessible without replacing the viewer", () => {
    render(
      <MatchLive
        snapshot={createSnapshot()}
        gameState={{ teams: [], players: [] } as unknown as GameStateData}
        userSide={null}
        isSpectator
        importantEvents={[]}
        onSnapshotUpdate={vi.fn()}
        onImportantEvent={vi.fn()}
        onHalfTime={vi.fn()}
        onFullTime={vi.fn()}
      />,
    );
    const pitch = screen.getByRole("img", { name: "live pitch" });
    expect(pitch).toBeVisible();
    expect(screen.getByRole("button", { name: "match.matchView" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "match.events" }));
    expect(pitch).not.toBeVisible();
    expect(screen.getByRole("button", { name: "match.events" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const match = screen.getByRole("button", { name: "match.matchView" });
    match.focus();
    expect(match).toHaveFocus();
    fireEvent.click(match);
    expect(pitch).toBeVisible();
    expect(screen.getByRole("button", { name: "match.stats" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "match.lineups" })).toBeInTheDocument();
  });
});

it("waits for the last clip before finishing and cancels automatic steps while paused", async () => {
  vi.useFakeTimers();
  const finished = vi.fn();
  const props = {
    snapshot: createSnapshot(),
    gameState: { teams: [], players: [] } as unknown as GameStateData,
    userSide: null,
    isSpectator: true,
    importantEvents: [],
    onSnapshotUpdate: vi.fn(),
    onImportantEvent: vi.fn(),
    onHalfTime: vi.fn(),
    onFullTime: finished,
  };
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ phase: "Finished", is_finished: true, events: [] }])
    .mockResolvedValueOnce({ ...props.snapshot, phase: "Finished" });
  const { unmount } = render(<MatchLive {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "match.pause" }));
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "match.normal" }));
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(invoke).toHaveBeenCalledWith("step_live_match", { minutes: 1 });
  expect(finished).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(3999));
  expect(finished).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(finished).toHaveBeenCalledOnce();
  unmount();
  vi.useRealTimers();
});

it("holds engine advancement and full time until every goal/foul/card cinematic is acknowledged", async () => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockClear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const finished = vi.fn();
  const snapshot = createSnapshot();
  const events = ["Foul", "YellowCard", "Goal"].map((event_type) => ({
    minute: 90,
    event_type,
    side: "Home" as const,
    zone: "AwayBox",
    player_id: "starter-1",
    secondary_player_id: null,
  }));
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ phase: "Finished", is_finished: true, events }])
    .mockResolvedValueOnce({ ...snapshot, events, phase: "Finished" });
  const { unmount } = render(
    <MatchLive
      snapshot={snapshot}
      gameState={{ teams: [], players: [] } as unknown as GameStateData}
      userSide={null}
      isSpectator
      importantEvents={[]}
      onSnapshotUpdate={vi.fn()}
      onImportantEvent={vi.fn()}
      onHalfTime={vi.fn()}
      onFullTime={finished}
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(screen.getByRole("dialog", { name: "match.eventTypes.Foul" })).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(12000));
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(finished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "match.continue" }));
  expect(screen.getByRole("dialog", { name: "match.eventTypes.YellowCard" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "match.continue" }));
  expect(screen.getByRole("dialog", { name: "match.eventTypes.Goal" })).toBeVisible();
  expect(finished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "match.continue" }));
  expect(finished).toHaveBeenCalledOnce();
  unmount();
  vi.useRealTimers();
});

it("preserves a manual pause after a stepped event cinematic", async () => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockClear();
  const snapshot = createSnapshot();
  const events = [
    {
      minute: 33,
      event_type: "RedCard",
      side: "Away" as const,
      zone: "Midfield",
      player_id: "opp-1",
      secondary_player_id: null,
    },
  ];
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ phase: "FirstHalf", is_finished: false, events }])
    .mockResolvedValueOnce({ ...snapshot, events });
  const { unmount } = render(
    <MatchLive
      snapshot={snapshot}
      gameState={{ teams: [], players: [] } as unknown as GameStateData}
      userSide={null}
      isSpectator
      importantEvents={[]}
      onSnapshotUpdate={vi.fn()}
      onImportantEvent={vi.fn()}
      onHalfTime={vi.fn()}
      onFullTime={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "match.pause" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "match.step1Min" })));
  // Even repeated stepping cannot overtake the pending presentation.
  fireEvent.click(screen.getByRole("button", { name: "match.step1Min" }));
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(screen.getByRole("dialog", { name: "match.eventTypes.RedCard" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "match.continue" }));
  await act(() => vi.advanceTimersByTimeAsync(12000));
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "match.step1Min" })).toBeVisible();
  unmount();
  vi.useRealTimers();
});

it("queues instant-speed incidents even in Events view and resumes the selected speed afterwards", async () => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
  const snapshot = createSnapshot();
  const events = ["Foul", "YellowCard"].map((event_type) => ({
    minute: 35,
    event_type,
    side: "Home" as const,
    zone: "Midfield",
    player_id: "starter-1",
    secondary_player_id: null,
  }));
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ phase: "FirstHalf", is_finished: false, events }])
    .mockResolvedValueOnce({ ...snapshot, events })
    .mockResolvedValue([]);
  const { unmount } = render(
    <MatchLive
      snapshot={snapshot}
      gameState={{ teams: [], players: [] } as unknown as GameStateData}
      userSide={null}
      isSpectator
      importantEvents={[]}
      onSnapshotUpdate={vi.fn()}
      onImportantEvent={vi.fn()}
      onHalfTime={vi.fn()}
      onFullTime={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "match.events" }));
  fireEvent.click(screen.getByRole("button", { name: "match.max" }));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(screen.getByRole("dialog", { name: "match.eventTypes.Foul" })).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(invoke).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "match.continue" }));
  fireEvent.click(screen.getByRole("button", { name: "match.continue" }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(invoke).toHaveBeenLastCalledWith("step_live_match", { minutes: 10 });
  expect(invoke).toHaveBeenCalledTimes(3);
  unmount();
  vi.useRealTimers();
});
