import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useDigestAdvance } from "./useDigestAdvance";
import type { OneDayResponse } from "../services/advanceTimeService";

vi.mock("../services/advanceTimeService", () => ({
  advanceOneDay: vi.fn(),
}));
vi.mock("../components/dashboard/advanceRecap", () => ({
  buildAdvanceRecap: vi.fn().mockReturnValue({
    advancedTo: "2026-09-02",
    matches: [],
    transfers: [],
    news: [],
    inbox: [],
    hasEvents: false,
  }),
  detectAttentionEvents: vi.fn().mockReturnValue([]),
}));

const { advanceOneDay } = await import("../services/advanceTimeService");
const { detectAttentionEvents } = await import("../components/dashboard/advanceRecap");
const mockedAdvanceOneDay = vi.mocked(advanceOneDay);
const mockedDetectAttentionEvents = vi.mocked(detectAttentionEvents);

function makeAdvancedResponse(date: string): OneDayResponse {
  return {
    action: "advanced",
    date,
    results: [],
    game: { clock: { current_date: `${date}T00:00:00Z` } } as never,
  };
}

describe("useDigestAdvance", () => {
  const setGameState = vi.fn();
  const onFired = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedDetectAttentionEvents.mockReset().mockReturnValue([]);
  });

  it("starts not running and with empty entries", () => {
    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));
    expect(result.current.isRunning).toBe(false);
    expect(result.current.entries).toEqual([]);
    expect(result.current.stopReason).toBeNull();
    expect(result.current.isVisible).toBe(false);
  });

  it("accumulates entries for each advanced day until match_day stop", async () => {
    mockedAdvanceOneDay
      .mockResolvedValueOnce(makeAdvancedResponse("2026-09-01"))
      .mockResolvedValueOnce(makeAdvancedResponse("2026-09-02"))
      .mockResolvedValueOnce({ action: "match_day", date: "2026-09-03", results: [] });

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest();
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].date).toBe("2026-09-01");
    expect(result.current.entries[1].date).toBe("2026-09-02");
    expect(result.current.stopReason).toEqual({ kind: "match_day" });
    expect(result.current.isVisible).toBe(true);
  });

  it("stops with blocked reason and surfaces blockers", async () => {
    mockedAdvanceOneDay.mockResolvedValueOnce({
      action: "blocked",
      date: "2026-09-01",
      blockers: [{ id: "injured_xi", severity: "warn", text: "2 injured", tab: "Squad" }],
      results: [],
    });

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest();
    });

    expect(result.current.stopReason).toMatchObject({ kind: "blocked" });
    if (result.current.stopReason?.kind === "blocked") {
      expect(result.current.stopReason.blockers).toHaveLength(1);
    }
    expect(result.current.entries).toHaveLength(0);
  });

  it("continues past acknowledged blockers but pauses again when a new action appears", async () => {
    const existingBlocker = {
      id: "urgent_messages",
      severity: "info",
      text: "1 urgent unread message(s)",
      text_key: "notifications.blockers.urgentMessages",
      text_params: { count: "1" },
      tab: "Inbox",
    };
    const newBlocker = {
      ...existingBlocker,
      text: "2 urgent unread message(s)",
      text_params: { count: "2" },
    };
    mockedAdvanceOneDay
      .mockResolvedValueOnce({
        action: "blocked",
        date: "2026-09-01",
        blockers: [existingBlocker],
        results: [],
      })
      .mockResolvedValueOnce({
        action: "blocked",
        date: "2026-09-01",
        blockers: [newBlocker],
        results: [],
      });

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest();
    });
    await act(async () => {
      await result.current.startDigest({
        resume: true,
        continueThroughEvents: true,
        acknowledgedBlockers: [existingBlocker],
      });
    });

    expect(mockedAdvanceOneDay).toHaveBeenNthCalledWith(2, [existingBlocker]);
    expect(result.current.stopReason).toEqual({ kind: "blocked", blockers: [newBlocker] });
  });

  it("calls onFired and sets fired stop reason when manager is dismissed", async () => {
    mockedAdvanceOneDay.mockResolvedValueOnce({
      action: "fired",
      date: "2026-09-01",
      results: [],
      game: { clock: { current_date: "2026-09-02T00:00:00Z" } } as never,
    });

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest();
    });

    expect(onFired).toHaveBeenCalledOnce();
    expect(result.current.stopReason).toEqual({ kind: "fired" });
  });

  it("stops with an event reason when a day produces an attention event", async () => {
    mockedAdvanceOneDay
      .mockResolvedValueOnce(makeAdvancedResponse("2026-09-01"))
      .mockResolvedValueOnce(makeAdvancedResponse("2026-09-02"));
    mockedDetectAttentionEvents.mockReturnValueOnce([]).mockReturnValueOnce(["userTransfer"]);

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest();
    });

    // The loop stops after the eventful day: no third advance call.
    expect(mockedAdvanceOneDay).toHaveBeenCalledTimes(2);
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.stopReason).toEqual({
      kind: "event",
      events: ["userTransfer"],
    });
    expect(result.current.isRunning).toBe(false);
  });

  it("keeps advancing through attention events in automatic mode until a match day", async () => {
    mockedAdvanceOneDay
      .mockResolvedValueOnce(makeAdvancedResponse("2026-09-01"))
      .mockResolvedValueOnce(makeAdvancedResponse("2026-09-02"))
      .mockResolvedValueOnce({ action: "match_day", date: "2026-09-03", results: [] });
    mockedDetectAttentionEvents
      .mockReturnValueOnce(["highPriorityInbox"])
      .mockReturnValueOnce(["userTransfer"]);

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest({ resume: true, continueThroughEvents: true });
    });

    expect(mockedAdvanceOneDay).toHaveBeenCalledTimes(3);
    expect(result.current.entries.map((entry) => entry.date)).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
    expect(result.current.stopReason).toEqual({ kind: "match_day" });
  });

  it("resuming after an event stop keeps the accumulated feed", async () => {
    mockedAdvanceOneDay.mockResolvedValueOnce(makeAdvancedResponse("2026-09-01"));
    mockedDetectAttentionEvents.mockReturnValueOnce(["highPriorityInbox"]);

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest();
    });
    expect(result.current.entries).toHaveLength(1);

    mockedAdvanceOneDay
      .mockResolvedValueOnce(makeAdvancedResponse("2026-09-02"))
      .mockResolvedValueOnce({ action: "match_day", date: "2026-09-03", results: [] });

    await act(async () => {
      await result.current.startDigest({ resume: true });
    });

    expect(result.current.entries.map((entry) => entry.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(result.current.stopReason).toEqual({ kind: "match_day" });
  });

  it("showStaticDigest presents a finished batch advance in the feed", () => {
    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    const entry = {
      date: "2026-09-01",
      recap: {
        advancedTo: "2026-09-02",
        matches: [],
        transfers: [],
        news: [],
        inbox: [],
        hasEvents: false,
        userTransferInWindow: false,
        userNewsInWindow: false,
      },
    };

    act(() => {
      result.current.showStaticDigest([entry], { kind: "match_day" });
    });

    expect(result.current.entries).toEqual([entry]);
    expect(result.current.stopReason).toEqual({ kind: "match_day" });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isVisible).toBe(true);
  });

  it("dismissDigest resets all state", async () => {
    mockedAdvanceOneDay.mockResolvedValueOnce({
      action: "match_day",
      date: "2026-09-01",
      results: [],
    });

    const { result } = renderHook(() => useDigestAdvance(setGameState, onFired));

    await act(async () => {
      await result.current.startDigest();
    });

    expect(result.current.stopReason).not.toBeNull();

    act(() => {
      result.current.dismissDigest();
    });

    expect(result.current.entries).toEqual([]);
    expect(result.current.stopReason).toBeNull();
    expect(result.current.isVisible).toBe(false);
  });
});
