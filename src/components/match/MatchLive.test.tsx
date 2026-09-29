import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  LiveMatchView: ({
    paused,
    onPlaybackComplete,
  }: {
    paused: boolean;
    onPlaybackComplete: () => void;
  }) => (
    <>
      <div role="img" aria-label="live pitch" data-paused={paused} />
      <button type="button" onClick={onPlaybackComplete}>
        Finish playback
      </button>
    </>
  ),
}));
vi.mock("../ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Select: ({
    children,
    selectSize: _selectSize,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & { selectSize?: string }) => (
    <select {...props}>{children}</select>
  ),
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
  it("sends live role and position-swap commands", async () => {
    vi.mocked(invoke).mockClear().mockResolvedValue(createSnapshot());
    render(
      <MatchLive
        snapshot={createSnapshot()}
        gameState={{ teams: [], players: [] } as unknown as GameStateData}
        userSide="Home"
        isSpectator={false}
        importantEvents={[]}
        onSnapshotUpdate={vi.fn()}
        onImportantEvent={vi.fn()}
        onHalfTime={vi.fn()}
        onFullTime={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /match.subs/ }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Starter One · tactics.playerRoleLabel" }),
      { target: { value: "BoxToBox" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "match.selectForSwap: Starter One" }));
    fireEvent.click(screen.getByRole("button", { name: "match.selectForSwap: Starter Two" }));

    await waitFor(() =>
      expect(
        vi.mocked(invoke).mock.calls.filter(([name]) => name === "apply_match_command"),
      ).toEqual([
        [
          "apply_match_command",
          {
            command: {
              ChangePlayerRole: { side: "Home", player_id: "starter-1", role: "BoxToBox" },
            },
          },
        ],
        [
          "apply_match_command",
          {
            command: {
              SwapPlayerPositions: {
                side: "Home",
                first_player_id: "starter-1",
                second_player_id: "starter-2",
              },
            },
          },
        ],
      ]),
    );
  });

  it("applies selected substitutions in order before closing the panel", async () => {
    vi.mocked(invoke).mockClear().mockResolvedValue(createSnapshot());
    const onSnapshotUpdate = vi.fn();
    render(
      <MatchLive
        snapshot={createSnapshot()}
        gameState={{ teams: [], players: [] } as unknown as GameStateData}
        userSide="Home"
        isSpectator={false}
        importantEvents={[]}
        onSnapshotUpdate={onSnapshotUpdate}
        onImportantEvent={vi.fn()}
        onHalfTime={vi.fn()}
        onFullTime={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /match.subs/ }));
    fireEvent.click(screen.getByTestId("sub-panel-off-starter-1"));
    fireEvent.click(screen.getByTestId("sub-panel-off-starter-2"));
    fireEvent.click(screen.getByTestId("sub-panel-bench-bench-1"));
    fireEvent.click(screen.getByTestId("sub-panel-bench-bench-2"));
    fireEvent.click(screen.getByRole("button", { name: "match.confirmSubstitution" }));
    await waitFor(() =>
      expect(screen.queryByTestId("sub-panel-off-starter-1")).not.toBeInTheDocument(),
    );
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === "apply_match_command")).toEqual(
      [
        [
          "apply_match_command",
          {
            command: {
              Substitute: { side: "Home", player_off_id: "starter-1", player_on_id: "bench-1" },
            },
          },
        ],
        [
          "apply_match_command",
          {
            command: {
              Substitute: { side: "Home", player_off_id: "starter-2", player_on_id: "bench-2" },
            },
          },
        ],
      ],
    );
    expect(onSnapshotUpdate).toHaveBeenCalledTimes(2);
    vi.mocked(invoke).mockReset();
  });

  it("applies a dropped replacement without closing the panel", async () => {
    vi.mocked(invoke).mockClear().mockResolvedValue(createSnapshot());
    render(
      <MatchLive
        snapshot={createSnapshot()}
        gameState={{ teams: [], players: [] } as unknown as GameStateData}
        userSide="Home"
        isSpectator={false}
        importantEvents={[]}
        onSnapshotUpdate={vi.fn()}
        onImportantEvent={vi.fn()}
        onHalfTime={vi.fn()}
        onFullTime={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /match.subs/ }));
    fireEvent.drop(screen.getByTestId("sub-panel-off-starter-1"), {
      dataTransfer: { getData: () => "bench-1" },
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("apply_match_command", {
        command: {
          Substitute: { side: "Home", player_off_id: "starter-1", player_on_id: "bench-1" },
        },
      }),
    );
    expect(screen.getByTestId("sub-panel-off-starter-1")).toBeInTheDocument();
    vi.mocked(invoke).mockReset();
  });

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
  expect(finished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Finish playback" }));
  expect(finished).toHaveBeenCalledOnce();
  unmount();
  vi.useRealTimers();
});

it("finishes after the final clip without asking to acknowledge incidents", async () => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
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
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(finished).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(finished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Finish playback" }));
  expect(finished).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  unmount();
  vi.useRealTimers();
});

it.each(["normal", "fast", "instant"] as const)(
  "keeps advancing through incidents at %s speed",
  async (speed) => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
    let minute = 32;
    vi.mocked(invoke).mockImplementation(async (command) => {
      const events = ["Foul", "YellowCard", "Goal"].map((event_type) => ({
        minute,
        event_type,
        side: "Home" as const,
        zone: "AwayBox",
        player_id: "starter-1",
        secondary_player_id: null,
      }));
      if (command === "step_live_match") {
        minute++;
        return [{ phase: "FirstHalf", is_finished: false, events }];
      }
      return { ...createSnapshot(), current_minute: minute, events };
    });
    function Match() {
      const [snapshot, setSnapshot] = useState(createSnapshot());
      return (
        <MatchLive
          snapshot={snapshot}
          gameState={{ teams: [], players: [] } as unknown as GameStateData}
          userSide={null}
          isSpectator
          importantEvents={[]}
          onSnapshotUpdate={setSnapshot}
          onImportantEvent={vi.fn()}
          onHalfTime={vi.fn()}
          onFullTime={vi.fn()}
        />
      );
    }
    const { unmount } = render(<Match />);
    fireEvent.click(
      screen.getByRole("button", { name: speed === "instant" ? "match.max" : `match.${speed}` }),
    );
    const interval = speed === "normal" ? 4000 : speed === "fast" ? 1000 : 100;
    await act(() => vi.advanceTimersByTimeAsync(interval));
    expect(screen.getByRole("img", { name: "live pitch" })).toHaveAttribute("data-paused", "false");
    await act(() => vi.advanceTimersByTimeAsync(interval + 2200));
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "step_live_match"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Finish playback" }));
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "step_live_match"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "match.pause" }));
    await act(() => vi.advanceTimersByTimeAsync(interval * 3));
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "step_live_match"),
    ).toHaveLength(2);
    expect(screen.getByRole("img", { name: "live pitch" })).toHaveAttribute("data-paused", "true");
    unmount();
    vi.useRealTimers();
  },
);
