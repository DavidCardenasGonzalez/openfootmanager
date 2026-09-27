import { expect, it } from "vitest";
import { messages } from "./index";
it("has every sandbox message in all twelve application languages", () => {
  expect(Object.keys(messages).sort()).toEqual(
    ["en", "es", "pt", "pt-BR", "fr", "de", "it", "ru", "zh-CN", "cs", "tr", "id"].sort(),
  );
  for (const dictionary of Object.values(messages)) {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(messages.en).sort());
    expect(Object.values(dictionary).every((s) => s.trim().length > 0)).toBe(true);
  }
});
