import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useGameStore, type GameStateData } from "../store/gameStore";
import { useSettingsStore } from "../store/settingsStore";
import type {
  MatchSnapshot,
  MatchEvent,
  MatchDayStage,
  RoundSummary,
  SubstitutionRecord,
} from "../components/match/types";
import { PLAY_STYLES } from "../components/match/types";
import { resolveMatchFixture } from "../components/match/helpers";
import { applyExtraTranslations } from "../lib/extraTranslations";
import PreMatchSetup from "../components/match/PreMatchSetup";
import MatchLive from "../components/match/MatchLive";
import HalfTimeBreak from "../components/match/HalfTimeBreak";
import PostMatchScreen from "../components/match/PostMatchScreen";
import RoundDigestScreen from "../components/match/RoundDigestScreen";
import PressConference from "../components/match/PressConference";
import PenaltyShootoutScreen from "../components/match/PenaltyShootoutScreen";

// ---------------------------------------------------------------------------
// Multi-stage Match Day Orchestrator
// ---------------------------------------------------------------------------

interface MatchRouteState {
  fixtureIndex?: number;
  mode?: string;
  snapshot?: MatchSnapshot;
}

interface FinishLiveMatchResponse {
  game: GameStateData;
  round_summary?: RoundSummary | null;
}

type UnityPlayStyle = Exclude<(typeof PLAY_STYLES)[number], "Possession">;
const unityPlayStyles = PLAY_STYLES.filter((style) => style !== "Possession");

interface UnityTacticsStatus {
  ready: boolean;
  pending: boolean;
  applied: { play_style: UnityPlayStyle; minute: number } | null;
  pending_substitution?: boolean;
  substitutions_ready?: boolean;
  substitutions_panel?: boolean;
  substitutions?: Omit<SubstitutionRecord, "side">[];
}

interface UnityPlayerUpdate {
  finished: boolean;
  tactics?: UnityTacticsStatus | null;
}

export default function MatchSimulation() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state as MatchRouteState | null) ?? null;
  const matchMode = routeState?.mode || "live";
  const { gameState, setGameState, setGameActive } = useGameStore();
  const checkRecoveredResult = useRef(!gameState);
  const { settings } = useSettingsStore();
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(routeState?.snapshot ?? null);
  const [stage, setStage] = useState<MatchDayStage>("prematch");
  const [importantEvents, setImportantEvents] = useState<MatchEvent[]>([]);
  const [userSide, setUserSide] = useState<"Home" | "Away" | null>(null);
  const [isSpectator, setIsSpectator] = useState(matchMode === "spectator");
  const [roundSummary, setRoundSummary] = useState<RoundSummary | null>(null);
  const [hasFinalizedMatch, setHasFinalizedMatch] = useState(false);
  const [unityPath, setUnityPath] = useState("");
  const [unityError, setUnityError] = useState("");
  const [unityBusy, setUnityBusy] = useState(false);
  const [unityEmbedded, setUnityEmbedded] = useState(false);
  const [unityTactics, setUnityTactics] = useState<UnityTacticsStatus | null>(null);
  const [unityOrderSending, setUnityOrderSending] = useState<"tactic" | "sub" | null>(null);
  const [unityOrderError, setUnityOrderError] = useState<"tactic" | "sub" | null>(null);
  const [unityOff, setUnityOff] = useState("");
  const [unityOn, setUnityOn] = useState("");
  const unityTacticRevision = useRef(0);
  const unityViewport = useRef<HTMLDivElement>(null);
  const [preferredSpeed, setPreferredSpeed] = useState<"slow" | "normal" | "fast">("normal");
  const [hasUserOverriddenSpeed, setHasUserOverriddenSpeed] = useState(false);

  useEffect(() => {
    if (gameState) return;
    let cancelled = false;
    void invoke<GameStateData>("get_active_game")
      .then((game) => {
        if (cancelled) return;
        applyExtraTranslations(game.extra_translations);
        setGameActive(true, `${game.manager.first_name} ${game.manager.last_name}`);
        setGameState(game);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to restore the active career:", error);
        navigate("/", { replace: true });
      });
    return () => { cancelled = true; };
  }, [gameState, navigate, setGameActive, setGameState]);

  useEffect(() => {
    console.info("[MatchSimulation] mount", {
      fixtureIndex: routeState?.fixtureIndex,
      hasGameState: !!gameState,
      hasRouteSnapshot: !!routeState?.snapshot,
      matchMode,
    });
  }, [gameState, matchMode, routeState?.fixtureIndex, routeState?.snapshot]);

  useEffect(() => {
    if (hasUserOverriddenSpeed) return;
    setPreferredSpeed(
      settings.match_speed === "slow" || settings.match_speed === "fast"
        ? settings.match_speed
        : "normal",
    );
  }, [settings.match_speed, hasUserOverriddenSpeed]);

  // Determine user side from game state
  useEffect(() => {
    if (!gameState || !snapshot) return;
    const utid = gameState.manager.team_id;
    if (!utid) {
      setIsSpectator(true);
      return;
    }
    if (snapshot.home_team.id === utid) setUserSide("Home");
    else if (snapshot.away_team.id === utid) setUserSide("Away");
    else setIsSpectator(true);

    // If mode is spectator, force spectator regardless of team
    if (matchMode === "spectator") setIsSpectator(true);

    console.info("[MatchSimulation] resolveSide", {
      awayTeamId: snapshot.away_team.id,
      homeTeamId: snapshot.home_team.id,
      matchMode,
      managerTeamId: utid,
      resolvedUserSide:
        snapshot.home_team.id === utid ? "Home" : snapshot.away_team.id === utid ? "Away" : null,
    });
  }, [gameState, snapshot?.home_team.id, snapshot?.away_team.id, matchMode]);

  // Fetch initial snapshot
  useEffect(() => {
    // Don't refetch after finalize — finish_live_match has cleared the backend
    // session, so get_match_snapshot would fail and the catch path would
    // start_live_match a fresh 0-0 session, clobbering the final score.
    if (hasFinalizedMatch) return;
    let isCancelled = false;

    const fetchSnapshot = async () => {
      console.info("[MatchSimulation] fetchSnapshot:start", {
        fixtureIndex: routeState?.fixtureIndex,
        hasRouteSnapshot: !!routeState?.snapshot,
        matchMode,
      });
      try {
        const snap = await invoke<MatchSnapshot | null>("get_match_snapshot");
        if (!snap) throw new Error("No active match snapshot");
        console.info("[MatchSimulation] fetchSnapshot:success", {
          awayPlayers: snap.away_team.players.length,
          awayTeam: snap.away_team.name,
          homePlayers: snap.home_team.players.length,
          homeTeam: snap.home_team.name,
          phase: snap.phase,
        });
        if (!isCancelled) {
          setSnapshot(snap);
        }
        return;
      } catch (snapshotError) {
        if (isCancelled) return;
        console.warn("[MatchSimulation] fetchSnapshot:failed", snapshotError);
        if (typeof routeState?.fixtureIndex !== "number") {
          console.error("Failed to get match snapshot:", snapshotError);
          navigate("/dashboard");
          return;
        }

        try {
          console.info("[MatchSimulation] restoreLiveMatch:start", {
            fixtureIndex: routeState.fixtureIndex,
            matchMode,
          });
          const fixture = gameState?.league?.fixtures?.[routeState.fixtureIndex];
          const competitionsWithET: string[] = [
            "Cup",
            "ContinentalClub",
            "InternationalClub",
            "InternationalNation",
            "FriendlyCup",
          ];
          const allowsExtraTime =
            routeState?.snapshot?.allows_extra_time ??
            competitionsWithET.includes(fixture?.competition ?? "");
          // Identify the fixture by its teams so the backend can resolve it
          // across all competitions — the raw index may point into a cup while
          // game.league mirrors the domestic league after a restart.
          const restoredSnapshot = await invoke<MatchSnapshot>("start_live_match", {
            allowsExtraTime,
            fixtureIndex: routeState.fixtureIndex,
            mode: matchMode,
            homeTeamId: routeState?.snapshot?.home_team?.id ?? null,
            awayTeamId: routeState?.snapshot?.away_team?.id ?? null,
          });

          console.info("[MatchSimulation] restoreLiveMatch:success", {
            awayPlayers: restoredSnapshot.away_team.players.length,
            awayTeam: restoredSnapshot.away_team.name,
            homePlayers: restoredSnapshot.home_team.players.length,
            homeTeam: restoredSnapshot.home_team.name,
            phase: restoredSnapshot.phase,
          });

          if (!isCancelled) {
            setSnapshot(restoredSnapshot);
          }
        } catch (restoreError) {
          if (isCancelled) return;
          console.error("Failed to restore live match session:", restoreError);
          navigate("/dashboard");
        }
      }
    };

    fetchSnapshot();

    return () => {
      isCancelled = true;
    };
  }, [
    hasFinalizedMatch,
    gameState,
    matchMode,
    navigate,
    routeState?.fixtureIndex,
    routeState?.snapshot,
  ]);

  // Skip pre-match for spectators
  useEffect(() => {
    if (isSpectator && stage === "prematch") {
      setStage("first_half");
    }
  }, [isSpectator, stage]);

  // Callbacks for stage transitions
  const handleStartMatch = useCallback(() => {
    console.info("[MatchSimulation] handleStartMatch");
    setStage("first_half");
  }, []);

  const handleHalfTime = useCallback((phase: "HalfTime" | "ExtraTimeHalfTime") => {
    console.info("[MatchSimulation] handleHalfTime", { phase });
    if (phase === "ExtraTimeHalfTime") {
      setStage("extra_time_halftime");
    } else {
      setStage("halftime");
    }
  }, []);

  const handleResumeFromHalfTime = useCallback(() => {
    console.info("[MatchSimulation] handleResumeFromHalfTime", { stage });
    setStage(stage === "extra_time_halftime" ? "extra_time_second_half" : "second_half");
  }, [stage]);

  const handlePenaltyShootout = useCallback(() => {
    console.info("[MatchSimulation] handlePenaltyShootout");
    setStage("penalty_shootout");
  }, []);

  const finalizeMatch = useCallback(async (): Promise<boolean> => {
    if (hasFinalizedMatch) {
      return true;
    }

    try {
      console.info("[MatchSimulation] finalizeMatch:start");
      const response = await invoke<FinishLiveMatchResponse>("finish_live_match");
      console.info("[MatchSimulation] finalizeMatch:success", {
        hasRoundSummary: !!response.round_summary,
        hasUpdatedGame: !!response.game,
      });
      setGameState(response.game);
      setRoundSummary(response.round_summary ?? null);
      setHasFinalizedMatch(true);
      if (settings.auto_save_after_match) {
        try {
          await invoke("save_game");
        } catch (saveError) {
          console.error("Failed to auto-save after match:", saveError);
        }
      }
      return true;
    } catch (err) {
      console.error("Failed to finish match:", err);
      return false;
    }
  }, [hasFinalizedMatch, setGameState, settings.auto_save_after_match]);

  const handleFullTime = useCallback(() => {
    console.info("[MatchSimulation] handleFullTime");
    void (async () => {
      const finalized = await finalizeMatch();
      if (finalized) {
        setStage("postmatch");
      }
    })();
  }, [finalizeMatch]);

  const handleFinishMatch = useCallback(async () => {
    console.info("[MatchSimulation] handleFinishMatch:start");
    const finalized = await finalizeMatch();
    if (finalized) {
      navigate("/dashboard");
    }
  }, [finalizeMatch, navigate]);

  const handlePostMatchContinue = useCallback(() => {
    if (isSpectator) {
      void handleFinishMatch();
      return;
    }
    console.info("[MatchSimulation] handlePostMatchContinue");
    setStage("digest");
  }, [isSpectator, handleFinishMatch]);

  const handlePressConference = useCallback(() => {
    console.info("[MatchSimulation] handlePressConference");
    setStage("press");
  }, []);

  // Deliberately unlogged: this fires once per simulated minute, and the effect that used to log
  // here ran on every tick for the whole match. The remaining logs are the low-frequency ones —
  // stage transitions and match lifecycle — not the per-minute path.
  const handleSnapshotUpdate = useCallback((snap: MatchSnapshot) => {
    setSnapshot(snap);
  }, []);

  const handleImportantEvent = useCallback((evt: MatchEvent) => {
    console.info("[MatchSimulation] handleImportantEvent", {
      eventType: evt.event_type,
      minute: evt.minute,
      side: evt.side,
    });
    setImportantEvents((prev) => [...prev, evt]);
  }, []);

  const handlePreferredSpeedChange = useCallback((speed: "slow" | "normal" | "fast") => {
    setHasUserOverriddenSpeed(true);
    setPreferredSpeed(speed);
  }, []);

  async function exportUnityMatch() {
    if (unityBusy) return;
    setUnityBusy(true);
    ++unityTacticRevision.current;
    setUnityTactics(null);
    setUnityOrderSending(null);
    setUnityOrderError(null);
    setUnityOff("");
    setUnityOn("");
    try {
      setUnityPath(await invoke<string>("export_unity_match"));
      setUnityError("");
      try {
        setUnityEmbedded(await invoke<boolean>("start_unity_player"));
      } catch (error) {
        console.warn("Embedded Unity is unavailable:", error);
      }
    } catch {
      setUnityError(t("unityMatch.invalid"));
    } finally {
      setUnityBusy(false);
    }
  }

  async function sendUnityOrder(order: { playStyle: UnityPlayStyle } | { playerOffId: string; playerOnId: string }) {
    const kind = "playStyle" in order ? "tactic" : "sub";
    const revision = ++unityTacticRevision.current;
    setUnityOrderSending(kind);
    setUnityOrderError(null);
    try {
      const status = await invoke<UnityTacticsStatus>(
        kind === "tactic" ? "set_unity_play_style" : "substitute_unity_player", order,
      );
      if (unityTacticRevision.current === revision) {
        setUnityTactics(status);
        if (kind === "sub") {
          setUnityOff("");
          setUnityOn("");
        }
      }
    } catch {
      if (unityTacticRevision.current === revision) setUnityOrderError(kind);
    } finally {
      if (unityTacticRevision.current === revision) {
        ++unityTacticRevision.current;
        setUnityOrderSending(null);
      }
    }
  }

  const finishUnityMatch = useCallback(async (quiet = false) => {
    setUnityBusy(true);
    try {
      const response = await invoke<FinishLiveMatchResponse & { home_goals: number; away_goals: number }>(
        "finish_unity_match",
      );
      setHasFinalizedMatch(true);
      setSnapshot((previous) => previous && ({
        ...previous,
        current_minute: 90,
        phase: "FullTime",
        home_score: response.home_goals,
        away_score: response.away_goals,
      }));
      setGameState(response.game);
      setRoundSummary(response.round_summary ?? null);
      setUnityEmbedded(false);
      setStage("digest");
      try {
        await invoke("save_game");
      } catch {
        window.alert(t("unityMatch.save"));
      }
    } catch (error) {
      if (!quiet) setUnityError(t(String(error), { defaultValue: t("unityMatch.invalid") }));
    } finally {
      setUnityBusy(false);
    }
  }, [setGameState, t]);

  useEffect(() => {
    if (!checkRecoveredResult.current || !gameState || !snapshot) return;
    checkRecoveredResult.current = false;
    if (snapshot.phase === "PreKickOff" && !snapshot.allows_extra_time) {
      void finishUnityMatch(true);
    }
  }, [finishUnityMatch, gameState, snapshot]);

  useEffect(() => {
    if (!unityEmbedded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function update() {
      if (!unityViewport.current || cancelled) return;
      const rect = unityViewport.current.getBoundingClientRect();
      const pixels = (value: number) => Math.round(value * window.devicePixelRatio);
      try {
        const revision = unityTacticRevision.current;
        const status = await invoke<UnityPlayerUpdate>("update_unity_player", {
          bounds: {
            x: pixels(rect.x),
            y: pixels(rect.y),
            width: pixels(rect.width),
            height: pixels(rect.height),
          },
        });
        if (cancelled) return;
        if (status.finished) {
          setUnityEmbedded(false);
          await finishUnityMatch();
          return;
        }
        if (unityTacticRevision.current === revision) setUnityTactics(status.tactics ?? null);
        timer = setTimeout(update, 350);
      } catch (error) {
        if (cancelled) return;
        setUnityError(t(String(error), { defaultValue: t("unityMatch.playerFailed") }));
        setUnityEmbedded(false);
      }
    }

    void update();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [finishUnityMatch, t, unityEmbedded]);

  useEffect(() => {
    if (!unityEmbedded) return;
    return () => {
      void invoke("stop_unity_player").catch(console.error);
    };
  }, [unityEmbedded]);

  // Loading state
  if (!snapshot || !gameState) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-navy-900 flex items-center justify-center transition-colors duration-300">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 dark:text-gray-400 font-heading uppercase tracking-wider text-sm">
            {t("dashboard.loading")}
          </span>
        </div>
      </div>
    );
  }

  const currentFixture = resolveMatchFixture(gameState, snapshot, routeState?.fixtureIndex);

  // Render the current stage
  switch (stage) {
    case "prematch": {
      if (!userSide) return null;
      const team = userSide === "Home" ? snapshot.home_team : snapshot.away_team;
      const bench = userSide === "Home" ? snapshot.home_bench : snapshot.away_bench;
      const initialStyle = team.play_style;
      const activeStyle = unityTactics?.applied?.play_style ??
        (initialStyle === "Possession" ? "Balanced" : initialStyle);
      const substitutions = unityTactics?.substitutions ?? [];
      const activePlayers = new Map(team.players.map((player) => [player.id, player]));
      for (const sub of substitutions) {
        activePlayers.delete(sub.player_off_id);
        const incoming = bench.find((player) => player.id === sub.player_on_id);
        if (incoming) activePlayers.set(incoming.id, incoming);
      }
      const reservePlayers = bench.filter((player) =>
        !substitutions.some((sub) => sub.player_on_id === player.id));
      const selectedOff = activePlayers.get(unityOff);
      const availableReserves = reservePlayers.filter((player) => selectedOff &&
        (selectedOff.position === "Goalkeeper") === (player.position === "Goalkeeper"));
      const lastSub = substitutions[substitutions.length - 1];
      const busy = !unityTactics?.ready || unityTactics.pending || unityOrderSending !== null;
      const subPending = unityTactics?.pending_substitution || unityOrderSending === "sub";
      const selectClass = "rounded-md border border-navy-600 bg-navy-800 px-3 py-1.5 text-sm text-white disabled:opacity-50";
      const playerName = (id: string) => [...team.players, ...bench].find((player) => player.id === id)?.name ?? id;
      return (
        <>
          {unityEmbedded ? (
            <div className="flex h-screen flex-col bg-navy-900">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-white">
                <span className="font-heading">Unity 3D</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {!unityTactics?.substitutions_panel && (
                    <>
                      <select
                        aria-label={t("tactics.playStyle")}
                        className={selectClass}
                        value={activeStyle}
                        disabled={busy}
                        onChange={(event) => {
                          const style = unityPlayStyles.find((option) => option === event.target.value);
                          if (style) void sendUnityOrder({ playStyle: style });
                        }}
                      >
                        {unityPlayStyles.map((style) => (
                          <option key={style} value={style}>{t(`common.playStyles.${style}`)}</option>
                        ))}
                      </select>
                      <span role="status" className="text-sm">
                        {unityOrderError === "tactic" ? t("unityMatch.tacticFailed")
                          : unityOrderSending === "tactic" || (unityTactics?.pending && !subPending) ? t("unityMatch.tacticPending")
                            : unityTactics?.applied ? t("unityMatch.tacticApplied", { minute: unityTactics.applied.minute })
                              : null}
                      </span>
                    </>
                  )}
                </div>
                <button onClick={() => setUnityEmbedded(false)}>{t("common.cancel")}</button>
              </div>
              {bench.length > 0 && unityTactics?.substitutions_ready && !unityTactics?.substitutions_panel && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2 text-white">
                  <select
                    className={selectClass}
                    aria-label={t("match.selectPlayerOff")}
                    value={unityOff}
                    disabled={busy || substitutions.length >= snapshot.max_subs || !reservePlayers.length}
                    onChange={(event) => { setUnityOff(event.target.value); setUnityOn(""); }}
                  >
                    <option value="">{t("match.selectPlayerOff")}</option>
                    {[...activePlayers.values()].map((player) => (
                      <option key={player.id} value={player.id}>{player.name}</option>
                    ))}
                  </select>
                  <select
                    className={selectClass}
                    aria-label={t("match.selectReplacement")}
                    value={unityOn}
                    disabled={busy || !availableReserves.length}
                    onChange={(event) => setUnityOn(event.target.value)}
                  >
                    <option value="">{t("match.selectReplacement")}</option>
                    {availableReserves.map((player) => (
                      <option key={player.id} value={player.id}>{player.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-md bg-primary-600 px-3 py-1.5 text-sm disabled:opacity-50"
                    disabled={busy || !selectedOff || !availableReserves.some((player) => player.id === unityOn)}
                    onClick={() => void sendUnityOrder({ playerOffId: unityOff, playerOnId: unityOn })}
                  >
                    {t("match.makeSubstitution")}
                  </button>
                  <span role="status" className="text-sm">
                    {unityOrderError === "sub" ? t("unityMatch.subFailed")
                      : subPending ? t("unityMatch.subPending")
                        : lastSub ? `${lastSub.minute}′ ${playerName(lastSub.player_on_id)} ${t("match.subFor", { name: playerName(lastSub.player_off_id) })}`
                          : t("match.subsUsed", { used: substitutions.length, max: snapshot.max_subs })}
                  </span>
                </div>
              )}
              <div ref={unityViewport} className="grid min-h-0 flex-1 place-items-center bg-black">
                <span role="status" className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
              </div>
            </div>
          ) : unityPath ? (
            <div className="m-auto flex max-w-xl flex-col gap-4 p-6">
              <p>{t("unityMatch.instructions")}</p>
              <code className="break-all">{unityPath}</code>
              <button disabled={unityBusy} onClick={() => void finishUnityMatch()}>
                {t("unityMatch.import")}
              </button>
              <button disabled={unityBusy} onClick={() => { setUnityPath(""); setUnityError(""); }}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <PreMatchSetup
              snapshot={snapshot}
              gameState={gameState}
              currentFixture={currentFixture}
              userSide={userSide}
              onStart={handleStartMatch}
              onUpdateSnapshot={handleSnapshotUpdate}
              onUnityStart={exportUnityMatch}
            />
          )}
          {unityError && <p role="alert" className="p-2 text-center">{unityError}</p>}
        </>
      );
    }

    case "first_half":
    case "second_half":
    case "extra_time_second_half":
      return (
        <MatchLive
          key={stage}
          snapshot={snapshot}
          gameState={gameState}
          userSide={userSide}
          isSpectator={isSpectator}
          importantEvents={importantEvents}
          preferredSpeed={preferredSpeed}
          onPreferredSpeedChange={handlePreferredSpeedChange}
          onSnapshotUpdate={handleSnapshotUpdate}
          onImportantEvent={handleImportantEvent}
          onHalfTime={handleHalfTime}
          onFullTime={handleFullTime}
          onPenaltyShootout={handlePenaltyShootout}
        />
      );

    case "halftime":
    case "extra_time_halftime":
      if (!userSide) return null;
      return (
        <HalfTimeBreak
          key={stage}
          snapshot={snapshot}
          gameState={gameState}
          userSide={userSide}
          isSpectator={isSpectator}
          importantEvents={importantEvents}
          onResume={handleResumeFromHalfTime}
          onUpdateSnapshot={handleSnapshotUpdate}
        />
      );

    case "penalty_shootout":
      return (
        <PenaltyShootoutScreen
          snapshot={snapshot}
          gameState={gameState}
          userSide={userSide}
          isSpectator={isSpectator}
          importantEvents={importantEvents}
          onSnapshotUpdate={handleSnapshotUpdate}
          onImportantEvent={handleImportantEvent}
          onFullTime={handleFullTime}
        />
      );

    case "postmatch":
      return (
        <PostMatchScreen
          snapshot={snapshot}
          gameState={gameState}
          userSide={userSide}
          isSpectator={isSpectator}
          importantEvents={importantEvents}
          onContinue={handlePostMatchContinue}
          onFinish={handleFinishMatch}
        />
      );

    case "digest": {
      const isLeagueFixture = currentFixture
        ? currentFixture.competition !== "Friendly" &&
          currentFixture.competition !== "PreseasonTournament"
        : roundSummary !== null;
      return (
        <RoundDigestScreen
          snapshot={snapshot}
          gameState={gameState}
          currentFixture={currentFixture}
          userSide={userSide}
          isLeagueFixture={isLeagueFixture}
          roundSummary={roundSummary}
          onPressConference={handlePressConference}
          onFinish={handleFinishMatch}
        />
      );
    }

    case "press":
      if (!userSide) return null;
      return (
        <PressConference
          snapshot={snapshot}
          gameState={gameState}
          userSide={userSide}
          onFinish={handleFinishMatch}
          onGameUpdate={setGameState}
        />
      );

    default:
      return null;
  }
}
