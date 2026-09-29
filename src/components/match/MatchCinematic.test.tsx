import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MatchCinematic, isCinematicEvent } from "./MatchCinematic";
import type { MatchEvent } from "./types";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const event = (event_type: string): MatchEvent => ({
  minute: 34,
  event_type,
  side: "Home",
  zone: "Midfield",
  player_id: "p1",
  secondary_player_id: null,
});
it("only announces confirmed goals, fouls and cards", () => {
  for (const kind of ["Goal", "PenaltyGoal", "Foul", "YellowCard", "RedCard", "SecondYellow"])
    expect(isCinematicEvent(event(kind))).toBe(true);
  for (const kind of ["ShotSaved", "ShotOnTarget", "PassCompleted", "PenaltyMiss"])
    expect(isCinematicEvent(event(kind))).toBe(false);
});
it("announces the incident without a modal, a continue button or moving focus", () => {
  render(<button type="button">Match controls</button>);
  const control = screen.getByRole("button");
  control.focus();
  render(<MatchCinematic event={event("SecondYellow")} playerName="Alex" teamName="Home United" />);
  expect(screen.getByRole("status")).toHaveTextContent("match.eventTypes.SecondYellow");
  expect(screen.getByRole("status")).toHaveTextContent("Alex");
  expect(screen.getByRole("status")).toHaveTextContent("Home United");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "match.continue" })).not.toBeInTheDocument();
  expect(control).toHaveFocus();
});

it("keeps the goal announcement and scorer visible after the opening headline settles", () => {
  const view = render(
    <MatchCinematic event={event("Goal")} playerName="Alex" teamName="Home United" elapsedMs={0} />,
  );
  const announcement = screen.getByRole("status", { name: "match.eventTypes.Goal" });
  view.rerender(
    <MatchCinematic
      event={event("Goal")}
      playerName="Alex"
      teamName="Home United"
      elapsedMs={5000}
    />,
  );
  expect(screen.getByRole("status", { name: "match.eventTypes.Goal" })).toBe(announcement);
  expect(announcement).toHaveTextContent("Alex");
  expect(announcement).toHaveTextContent("Home United");
});
