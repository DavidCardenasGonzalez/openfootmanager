import { describe, expect, it } from "vitest";
import {
  formatContractEndDate,
    getContractYearsRemaining,
  getDaysUntil,
} from "./contractUtils";

describe("contract date display", () => {
  it("handles a bare contract year from imported data", () => {
    expect(formatContractEndDate("2026.0")).toBe("2026");
    expect(getContractYearsRemaining("2026.0", "2025-12-31")).toBe("1 año");
  });

  it("does not expose NaN for malformed contract or current dates", () => {
    expect(formatContractEndDate("not-a-date")).toBeNull();
    expect(getContractYearsRemaining("not-a-date", "2025-01-01")).toBe("—");
    expect(getContractYearsRemaining("2026-06-30", "not-a-date")).toBe("—");
    expect(getDaysUntil("not-a-date", "2025-01-01")).toBe(0);
  });
});
