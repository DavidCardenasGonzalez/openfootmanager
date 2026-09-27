import { act, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { LiveMatchView } from "./LiveMatchView";
import type { EnginePlayerData, EngineTeamData, MatchSnapshot } from "./types";
import type { RenderSample } from "../../../match-lab/src/match/types";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../match-lab/src/renderer/MatchCanvas", () => ({
  MatchCanvas: ({ sample }: { sample: RenderSample }) => (
    <output aria-label="rendered match">{JSON.stringify(sample)}</output>
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
