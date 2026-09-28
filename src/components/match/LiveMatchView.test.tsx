import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { LiveMatchView } from "./LiveMatchView";
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
