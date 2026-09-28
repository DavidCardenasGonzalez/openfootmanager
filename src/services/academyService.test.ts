import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getAcademy, signAcademyCandidate, rejectAcademyCandidate } from "./academyService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("academy service", () => {
  it("sends candidate identity through the registered commands", async () => {
    vi.mocked(invoke).mockResolvedValue({});
    await getAcademy();
    expect(invoke).toHaveBeenLastCalledWith("get_academy");
    await signAcademyCandidate("candidate-1");
    expect(invoke).toHaveBeenLastCalledWith("sign_academy_candidate", {
      candidateId: "candidate-1",
    });
    await rejectAcademyCandidate("candidate-2");
    expect(invoke).toHaveBeenLastCalledWith("reject_academy_candidate", {
      candidateId: "candidate-2",
    });
  });
  it("preserves signing errors so the screen can explain the failed decision", async () => {
    vi.mocked(invoke).mockRejectedValue("academy.wageError");
    await expect(signAcademyCandidate("candidate-1")).rejects.toBe("academy.wageError");
  });
});
