import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { LiveMatchView } from "./LiveMatchView";
import { LIVE_CLIP_MS, LIVE_GOAL_CELEBRATION_MS } from "./livePresentation";
import type { EnginePlayerData, EngineTeamData, MatchSnapshot } from "./types";
import type { RenderSample } from "../../../match-lab/src/match/types";
import type { Kit, MatchKits } from "../../../match-lab/src/renderer/kits";
import { useSettingsStore } from "../../store/settingsStore";
const worldState = vi.hoisted(() => ({
  teams: [] as { id: string; kits: { home: Kit; away: Kit } }[],
}));
vi.mock("../../store/gameStore", () => ({
  useGameStore: (selector: (state: { gameState: typeof worldState }) => unknown) =>
    selector({ gameState: worldState }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../match-lab/src/renderer/MatchCanvas", () => ({
  MatchCanvas: ({
    sample,
    playerLabels,
    kits,
  }: {
    sample: RenderSample;
    kits?: MatchKits;
    playerLabels?: ReadonlyMap<string, { name?: string; rating?: number }>;
  }) => (
    <>
      <output aria-label="rendered kits">{JSON.stringify(kits)}</output>
      <output aria-label="rendered match">{JSON.stringify(sample)}</output>
      {sample.frame.players.map((player) => (
        <div key={player.id}>
          {playerLabels?.get(player.id)?.name}
          <output aria-label={`rating ${player.id}`}>
            {playerLabels?.get(player.id)?.rating?.toFixed(1)}
          </output>
        </div>
      ))}
    </>
  ),
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

let callback: FrameRequestCallback;
const sample = () =>
  JSON.parse(screen.getByLabelText("rendered match").textContent ?? "{}") as RenderSample;
beforeEach(() => {
  worldState.teams = [];
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      show_match_player_names: true,
      show_match_player_ratings: true,
    },
  });
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      callback = cb;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
it("shows names and live ratings, lets each be hidden, and remembers the selection", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const view = render(
    <LiveMatchView snapshot={snapshot} numbers={numbers} speed="normal" paused={false} />,
  );
  expect(screen.getByText("Starter One")).toBeInTheDocument();
  expect(screen.getByLabelText("rating starter-1")).toHaveTextContent("6.0");
  fireEvent.click(screen.getByRole("checkbox", { name: "match.showPlayerNames" }));
  expect(screen.queryByText("Starter One")).not.toBeInTheDocument();
  expect(screen.getByLabelText("rating starter-1")).toHaveTextContent("6.0");
  fireEvent.click(screen.getByRole("checkbox", { name: "match.showPlayerRatings" }));
  expect(screen.getByLabelText("rating starter-1")).toBeEmptyDOMElement();
  view.unmount();
  render(<LiveMatchView snapshot={snapshot} numbers={numbers} speed="normal" paused={false} />);
  expect(screen.getByRole("checkbox", { name: "match.showPlayerNames" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "match.showPlayerRatings" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "match.showPlayerNames" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "match.showPlayerRatings" }));
  expect(screen.getByText("Starter One")).toBeInTheDocument();
  expect(screen.getByLabelText("rating starter-1")).toHaveTextContent("6.0");
});
it("updates ratings when each new play completes and exposes the result while paused", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const { rerender } = render(
    <LiveMatchView snapshot={snapshot} numbers={numbers} speed="normal" paused={false} />,
  );
  const next: MatchSnapshot = {
    ...snapshot,
    current_minute: 33,
    events: [
      {
        minute: 33,
        event_type: "Goal",
        side: "Home",
        zone: "AwayBox",
        player_id: "starter-2",
        secondary_player_id: "starter-1",
      },
    ],
  };
  rerender(<LiveMatchView snapshot={next} numbers={numbers} speed="normal" paused={false} />);
  expect(screen.getByLabelText("rating starter-2")).toHaveTextContent("6.0");
  act(() => callback(4000));
  expect(screen.getByLabelText("rating starter-2")).toHaveTextContent("7.2");
  expect(screen.getByLabelText("rating starter-1")).toHaveTextContent("6.7");
  rerender(
    <LiveMatchView
      snapshot={{ ...next, current_minute: 34 }}
      numbers={numbers}
      speed="paused"
      paused
    />,
  );
  expect(screen.getByLabelText("rating starter-2")).toHaveTextContent("7.2");
});
it("positions names above players and ratings below them in the actual pitch", async () => {
  const { MatchCanvas } = await vi.importActual<
    typeof import("../../../match-lab/src/renderer/MatchCanvas")
  >("../../../match-lab/src/renderer/MatchCanvas");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const snapshot = createSnapshot();
  const view = render(
    <LiveMatchView snapshot={snapshot} numbers={new Map()} speed="paused" paused />,
  );
  const currentSample = sample();
  view.unmount();
  render(
    <MatchCanvas
      sample={currentSample}
      showNumbers
      showCoordinates={false}
      label="pitch"
      goalLabel="goal"
      playerLabels={new Map([["starter-1", { name: "Starter One", rating: 7.2 }]])}
    />,
  );
  const canvas = screen.getByRole("img", { name: "pitch" });
  expect(canvas).toHaveAttribute("width", "1120");
  expect(canvas).toHaveAttribute("height", "800");
  const name = screen.getByText("Starter One");
  const rating = screen.getByText("7.2");
  // The player's projected feet are at 40.76% of the pitch height.
  expect(Number.parseFloat(name.style.top)).toBeLessThan(40.76);
  expect(Number.parseFloat(rating.style.top)).toBeGreaterThan(40.76);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("freezes when paused, resumes the same clip and renders only newly received events", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const { rerender } = render(
    <LiveMatchView snapshot={snapshot} numbers={numbers} speed="normal" paused={false} />,
  );
  act(() => callback(500));
  expect(sample().frame.timeMs).toBe(500);
  rerender(<LiveMatchView snapshot={snapshot} numbers={numbers} speed="paused" paused />);
  act(() => callback(1500));
  expect(sample().frame.timeMs).toBe(500);
  rerender(<LiveMatchView snapshot={snapshot} numbers={numbers} speed="normal" paused={false} />);
  act(() => callback(200));
  expect(sample().frame.timeMs).toBe(700);
  const next: MatchSnapshot = {
    ...snapshot,
    current_minute: 33,
    home_score: 2,
    events: [
      {
        minute: 33,
        event_type: "Goal",
        side: "Home",
        zone: "AwayBox",
        player_id: "starter-2",
        secondary_player_id: null,
      },
    ],
  };
  rerender(<LiveMatchView snapshot={next} numbers={numbers} speed="normal" paused={false} />);
  act(() => callback(5000));
  expect(sample().event?.kind).toBe("goal");
  expect(sample().frame.score.home).toBe(2);
  const after = { ...next, current_minute: 34 };
  rerender(<LiveMatchView snapshot={after} numbers={numbers} speed="normal" paused={false} />);
  expect(sample().event?.kind).not.toBe("goal");
});
it("shows the resulting frame when stepping while paused and honors reduced motion", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const { rerender } = render(
    <LiveMatchView snapshot={snapshot} numbers={numbers} speed="paused" paused />,
  );
  expect(sample().frame.timeMs).toBe(4000);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  rerender(
    <LiveMatchView
      snapshot={{ ...snapshot, current_minute: 33 }}
      numbers={numbers}
      speed="normal"
      paused={false}
    />,
  );
  act(() => callback(16));
  expect(sample().frame.timeMs).toBe(4000);
});

it("passes the actual match teams' world kits to the renderer by ID", () => {
  const home: Kit = { pattern: "Solid", colors: { primary: "#FFFFFF", secondary: "#FEBE10" } };
  const away: Kit = { pattern: "Solid", colors: { primary: "#0057B8", secondary: "#FFFFFF" } };
  worldState.teams = [
    { id: "team-2", kits: { home, away } },
    { id: "team-1", kits: { home, away } },
  ];
  render(<LiveMatchView snapshot={createSnapshot()} numbers={new Map()} speed="paused" paused />);
  expect(JSON.parse(screen.getByLabelText("rendered kits").textContent ?? "{}")).toEqual({
    home,
    away,
  });
});

it("announces each incident at its replay position and a goal only when the ball reaches the net", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const { rerender } = render(
    <LiveMatchView snapshot={snapshot} numbers={numbers} speed="normal" paused={false} />,
  );
  const events = ["PassCompleted", "Foul", "YellowCard", "Goal"].map((event_type) => ({
    minute: 33,
    event_type,
    side: "Home" as const,
    zone: "AwayBox",
    player_id: "starter-2",
    secondary_player_id: null,
  }));
  const next = { ...snapshot, current_minute: 33, home_score: 2, events };
  rerender(<LiveMatchView snapshot={next} numbers={numbers} speed="normal" paused={false} />);
  expect(screen.queryByRole("status", { name: /match.eventTypes/ })).not.toBeInTheDocument();
  act(() => callback(1000));
  expect(screen.getByRole("status", { name: /match.eventTypes/ })).toHaveTextContent(
    "match.eventTypes.Foul",
  );
  act(() => callback(2000));
  expect(screen.getByRole("status", { name: /match.eventTypes/ })).toHaveTextContent(
    "match.eventTypes.YellowCard",
  );
  act(() => callback(3000));
  expect(screen.queryByRole("status", { name: /match.eventTypes/ })).not.toBeInTheDocument();
  act(() => callback(3799));
  expect(screen.queryByRole("status", { name: /match.eventTypes/ })).not.toBeInTheDocument();
  act(() => callback(3800));
  expect(screen.getByRole("status", { name: /match.eventTypes/ })).toHaveTextContent(
    "match.eventTypes.Goal",
  );
  expect(sample().frame.ball.motion).toBe("goal");
  act(() => callback(4000));
  expect(sample().frame.timeMs).toBe(4000);
  rerender(
    <LiveMatchView
      snapshot={{ ...next, current_minute: 34 }}
      numbers={numbers}
      speed="normal"
      paused={false}
    />,
  );
  expect(screen.queryByRole("status", { name: /match.eventTypes/ })).not.toBeInTheDocument();
});

it.each([
  ["slow", 8000],
  ["normal", 4000],
  ["fast", 1000],
  ["instant", 100],
] as const)("keeps the goal announcement on replay time at %s speed", (speed, duration) => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const { rerender } = render(
    <LiveMatchView snapshot={snapshot} numbers={numbers} speed={speed} paused={false} />,
  );
  const next = {
    ...snapshot,
    current_minute: 33,
    events: [
      {
        minute: 33,
        event_type: "PenaltyGoal",
        side: "Home" as const,
        zone: "AwayBox",
        player_id: "starter-2",
        secondary_player_id: null,
      },
    ],
  };
  rerender(<LiveMatchView snapshot={next} numbers={numbers} speed={speed} paused={false} />);
  act(() => callback(duration * 0.79));
  expect(screen.queryByRole("status", { name: /match.eventTypes/ })).not.toBeInTheDocument();
  act(() => callback(duration * 0.8));
  expect(screen.getByRole("status", { name: "match.eventTypes.PenaltyGoal" })).toBeVisible();
  act(() => callback(duration));
  expect(screen.getByRole("status", { name: "match.eventTypes.PenaltyGoal" })).toBeVisible();
  act(() => callback(duration + 2 * LIVE_GOAL_CELEBRATION_MS));
  expect(sample().frame.timeMs).toBe(LIVE_CLIP_MS + LIVE_GOAL_CELEBRATION_MS);
});
it("does not replay saved incidents and shows a manually stepped card while remaining paused", () => {
  const snapshot = {
    ...createSnapshot(),
    events: [
      {
        minute: 32,
        event_type: "Foul",
        side: "Home" as const,
        zone: "Midfield",
        player_id: "starter-2",
        secondary_player_id: null,
      },
    ],
  };
  const numbers = new Map<string, number>();
  const { rerender } = render(
    <LiveMatchView snapshot={snapshot} numbers={numbers} speed="paused" paused />,
  );
  expect(screen.queryByRole("status", { name: /match.eventTypes/ })).not.toBeInTheDocument();
  const next = {
    ...snapshot,
    current_minute: 33,
    events: [
      ...snapshot.events,
      {
        ...snapshot.events[0],
        minute: 33,
        event_type: "RedCard",
      },
    ],
  };
  rerender(<LiveMatchView snapshot={next} numbers={numbers} speed="paused" paused />);
  expect(screen.getByRole("status", { name: "match.eventTypes.RedCard" })).toBeVisible();
  act(() => callback(8000));
  expect(sample().frame.timeMs).toBe(4000);
  expect(screen.getByRole("status", { name: "match.eventTypes.RedCard" })).toBeVisible();
});

it("keeps goal commentary and the presented score hidden until confirmation", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const onPresentedScore = vi.fn();
  const view = render(
    <LiveMatchView
      snapshot={snapshot}
      numbers={numbers}
      speed="normal"
      paused={false}
      onPresentedScore={onPresentedScore}
    />,
  );
  const next = {
    ...snapshot,
    home_score: 2,
    events: [
      {
        minute: 33,
        event_type: "Goal",
        side: "Home" as const,
        zone: "AwayBox",
        player_id: "starter-2",
        secondary_player_id: null,
      },
    ],
  };
  view.rerender(
    <LiveMatchView
      snapshot={next}
      numbers={numbers}
      speed="normal"
      paused={false}
      onPresentedScore={onPresentedScore}
    />,
  );
  act(() => callback(2000));
  expect(screen.queryByText(/33' · match.eventTypes.Goal/)).not.toBeInTheDocument();
  expect(sample().frame.score.home).toBe(1);
  expect(onPresentedScore).toHaveBeenLastCalledWith({ home: 1, away: 0 });
  act(() => callback(3200));
  expect(screen.getByRole("status", { name: "match.eventTypes.Goal" })).toBeVisible();
  expect(onPresentedScore).toHaveBeenLastCalledWith({ home: 2, away: 0 });
  expect(screen.getByText(/33' · match.eventTypes.Goal/)).toBeVisible();
});

it("publishes a goal to the event feed once, together with its visual confirmation", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const onGoalConfirmed = vi.fn();
  const view = render(
    <LiveMatchView
      snapshot={snapshot}
      numbers={numbers}
      speed="fast"
      paused={false}
      onGoalConfirmed={onGoalConfirmed}
    />,
  );
  const goal = {
    minute: 33,
    event_type: "Goal",
    side: "Home" as const,
    zone: "AwayBox",
    player_id: "starter-2",
    secondary_player_id: null,
  };
  view.rerender(
    <LiveMatchView
      snapshot={{ ...snapshot, home_score: 2, events: [goal] }}
      numbers={numbers}
      speed="fast"
      paused={false}
      onGoalConfirmed={onGoalConfirmed}
    />,
  );
  act(() => callback(799));
  expect(onGoalConfirmed).not.toHaveBeenCalled();
  act(() => callback(800));
  expect(onGoalConfirmed).toHaveBeenCalledExactlyOnceWith(goal);
  act(() => callback(1800));
  expect(onGoalConfirmed).toHaveBeenCalledTimes(1);
});

it("waits for the entire celebration before allowing another step or the final whistle", () => {
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const onPlaybackComplete = vi.fn();
  const view = render(
    <LiveMatchView
      snapshot={snapshot}
      numbers={numbers}
      speed="instant"
      paused={false}
      onPlaybackComplete={onPlaybackComplete}
    />,
  );
  const next = {
    ...snapshot,
    phase: "Finished",
    home_score: 2,
    events: [
      {
        minute: 90,
        event_type: "Goal",
        side: "Home" as const,
        zone: "AwayBox",
        player_id: "starter-2",
        secondary_player_id: null,
      },
    ],
  };
  view.rerender(
    <LiveMatchView
      snapshot={next}
      numbers={numbers}
      speed="paused"
      paused={false}
      onPlaybackComplete={onPlaybackComplete}
    />,
  );
  act(() => callback(80));
  expect(screen.getByRole("status", { name: "match.eventTypes.Goal" })).toBeVisible();
  act(() => callback(2080));
  expect(onPlaybackComplete).not.toHaveBeenCalled();
  act(() => callback(880 + LIVE_GOAL_CELEBRATION_MS));
  expect(onPlaybackComplete).toHaveBeenCalledOnce();
  act(() => callback(20000));
  expect(onPlaybackComplete).toHaveBeenCalledOnce();
});

it("retains every goal announcement with reduced motion, including goals followed by another play", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const snapshot = createSnapshot();
  const numbers = new Map<string, number>();
  const onGoalConfirmed = vi.fn();
  const view = render(
    <LiveMatchView
      snapshot={snapshot}
      numbers={numbers}
      speed="instant"
      paused={false}
      onGoalConfirmed={onGoalConfirmed}
    />,
  );
  const next = {
    ...snapshot,
    home_score: 2,
    away_score: 1,
    events: [
      {
        minute: 33,
        event_type: "Goal",
        side: "Home" as const,
        zone: "AwayBox",
        player_id: "starter-2",
        secondary_player_id: null,
      },
      {
        minute: 34,
        event_type: "Goal",
        side: "Away" as const,
        zone: "HomeBox",
        player_id: "opp-1",
        secondary_player_id: null,
      },
      {
        minute: 35,
        event_type: "PassCompleted",
        side: "Home" as const,
        zone: "Midfield",
        player_id: "starter-2",
        secondary_player_id: null,
      },
    ],
  };
  view.rerender(
    <LiveMatchView
      snapshot={next}
      numbers={numbers}
      speed="instant"
      paused={false}
      onGoalConfirmed={onGoalConfirmed}
    />,
  );
  act(() => callback(16));
  expect(screen.getByRole("status", { name: "match.eventTypes.Goal" })).toHaveTextContent(
    "Starter Two",
  );
  const firstPose = sample().frame.players.map((p) => [p.id, p.x, p.y, p.action]);
  act(() => callback(1016));
  expect(sample().frame.players.map((p) => [p.id, p.x, p.y, p.action])).toEqual(firstPose);
  expect(onGoalConfirmed).toHaveBeenCalledTimes(1);
  act(() => callback(LIVE_GOAL_CELEBRATION_MS + 2016));
  expect(screen.getByRole("status", { name: "match.eventTypes.Goal" })).toHaveTextContent(
    "Opponent One",
  );
  expect(onGoalConfirmed).toHaveBeenCalledTimes(2);
});
