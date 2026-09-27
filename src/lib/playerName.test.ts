import { describe, expect, it } from "vitest";

import { getPlayerDisplayName } from "./playerName";

describe("getPlayerDisplayName", () => {
  it("prefers the imported shortName from source data", () => {
    expect(
      getPlayerDisplayName({
        match_name: "Jude Victor William Bellingham",
        full_name: "Jude Victor William Bellingham",
        media: { source_data: { shortName: "J. Bellingham" } },
      }),
    ).toBe("J. Bellingham");
  });

  it("supports snake case source data and falls back to match_name", () => {
    expect(
      getPlayerDisplayName({
        match_name: "J. Bellingham",
        full_name: "Jude Victor William Bellingham",
        media: { source_data: { short_name: "Jude Bellingham" } },
      }),
    ).toBe("Jude Bellingham");
    expect(
      getPlayerDisplayName({ match_name: "J. Bellingham", full_name: "Jude Bellingham" }),
    ).toBe("J. Bellingham");
  });
});
