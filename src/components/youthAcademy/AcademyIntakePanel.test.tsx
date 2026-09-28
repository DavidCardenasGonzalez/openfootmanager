import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AcademyIntakePanel from "./AcademyIntakePanel";
import type { AcademyView } from "../../services/academyService";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const intake: AcademyView = {
  level: 3,
  cycle: 1,
  expires_on: "2027-10-01",
  signing_limit: 3,
  signings_remaining: 2,
  roster_size: 26,
  roster_limit: 28,
  next_candidates: 10,
  next_signings: 3,
  upgrade_cost: 750000,
  upgrade_available: true,
  candidates: [
    {
      id: "c1",
      full_name: "Academy Prospect",
      date_of_birth: "2009-01-01",
      nationality: "England",
      position: "Forward",
      ovr: 58,
      potential_low: 68,
      potential_high: 82,
      signing_fee: 30000,
      annual_wage: 7800,
    },
  ],
};

describe("academy intake choices", () => {
  it("shows uncertainty and lets the manager sign or reject a specific candidate", () => {
    const sign = vi.fn();
    const reject = vi.fn();
    render(
      <AcademyIntakePanel
        intake={intake}
        pending={null}
        error={null}
        onSign={sign}
        onReject={reject}
        onUpgrade={vi.fn()}
      />,
    );
    expect(screen.getByText("68–82")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "academy.sign" }));
    expect(sign).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("button", { name: "academy.reject" }));
    expect(reject).toHaveBeenCalledWith("c1");
  });
  it("disables signings when quota or squad room runs out and keeps rejection available", () => {
    render(
      <AcademyIntakePanel
        intake={{ ...intake, roster_size: 28, signings_remaining: 0 }}
        pending={null}
        error={null}
        onSign={vi.fn()}
        onReject={vi.fn()}
        onUpgrade={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "academy.sign" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "academy.reject" })).not.toBeDisabled();
  });
});
