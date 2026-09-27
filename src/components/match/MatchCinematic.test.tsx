import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MatchCinematic, isCinematicEvent } from "./MatchCinematic";
import type { MatchEvent } from "./types";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
const event = (event_type: string): MatchEvent => ({
  minute: 34,
  event_type,
  side: "Home",
  zone: "Midfield",
  player_id: "p1",
  secondary_player_id: null,
});
it("only interrupts for confirmed goals, fouls and cards", () => {
  for (const kind of ["Goal", "PenaltyGoal", "Foul", "YellowCard", "RedCard", "SecondYellow"])
    expect(isCinematicEvent(event(kind))).toBe(true);
  for (const kind of ["ShotSaved", "ShotOnTarget", "PassCompleted", "PenaltyMiss"])
    expect(isCinematicEvent(event(kind))).toBe(false);
});
it("names the incident and player, focuses Continue, and permits keyboard dismissal", () => {
  const onContinue = vi.fn();
  render(
    <MatchCinematic
      event={event("SecondYellow")}
      playerName="Alex"
      teamName="Home United"
      onContinue={onContinue}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "match.eventTypes.SecondYellow" });
  expect(screen.getByText("Alex")).toBeVisible();
  expect(screen.getByText(/Home United/)).toBeVisible();
  expect(screen.getByRole("button", { name: "match.continue" })).toHaveFocus();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(onContinue).toHaveBeenCalledOnce();
});
