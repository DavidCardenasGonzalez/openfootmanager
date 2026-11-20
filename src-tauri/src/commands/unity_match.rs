use crate::application::live_match::{finish_session, FinishLiveMatchResponse};
use engine::{
    EventType, MatchEvent, MatchReport, MatchSnapshot, PlayerData, Position, Side, TeamData, Zone,
};
use ofm_core::state::StateManager;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

const INVALID: &str = "unityMatch.invalid";

fn team(team: &TeamData, bench: Option<&[PlayerData]>) -> Result<Value, String> {
    let formation = match team.formation.as_str() {
        "4-2-3-1" => "_4_2_3_1_A".to_owned(),
        "4-4-2" | "4-3-3" | "5-3-2" | "5-4-1" | "3-5-2" | "3-4-3" | "4-1-4-1" | "4-3-2-1"
        | "4-1-3-2" | "5-2-3" | "2-3-5" => format!("_{}", team.formation.replace('-', "_")),
        _ => return Err(INVALID.into()),
    };
    if team.players.len() != 11 || team.players[0].position != engine::Position::Goalkeeper {
        return Err(INVALID.into());
    }
    let mut value =
        json!({"id":team.id,"name":team.name,"formation":formation,"players":team.players});
    if let Some(bench) = bench {
        value["play_style"] = json!(team.play_style);
        value["bench"] = json!(bench);
    }
    Ok(value)
}

#[tauri::command]
pub fn export_unity_match(state: State<'_, Arc<StateManager>>) -> Result<String, String> {
    export_request(&state)
}

pub(super) fn export_request(state: &StateManager) -> Result<String, String> {
    let save_id = state.get_save_id();
    let request = state
        .with_live_match(|live| -> Result<Value, String> {
            let snapshot = live.snapshot();
            if snapshot.current_minute != 0 || snapshot.allows_extra_time {
                return Err(INVALID.into());
            }
            Ok(json!({
                "version": 1,
                "request_id": live.external_match_id(save_id.as_deref(), &snapshot),
                "home": team(&snapshot.home_team, (live.user_side == Some(Side::Home)).then_some(snapshot.home_bench.as_slice()))?,
                "away": team(&snapshot.away_team, (live.user_side == Some(Side::Away)).then_some(snapshot.away_bench.as_slice()))?,
                "max_subs": snapshot.max_subs,
            }))
        })
        .ok_or("be.error.noActiveLiveMatch")??;
    let directory = bridge_dir();
    std::fs::create_dir_all(&directory).map_err(|_| INVALID)?;
    let path = directory.join(format!(
        "{}.request.json",
        request["request_id"].as_str().ok_or(INVALID)?
    ));
    std::fs::write(&path, request.to_string()).map_err(|_| INVALID)?;
    Ok(path.display().to_string())
}

#[derive(Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct UnityResult {
    version: u8,
    status: String,
    request_id: String,
    home_id: String,
    away_id: String,
    home_goals: Option<u8>,
    away_goals: Option<u8>,
    player_ids: Vec<String>,
    goals: Vec<UnityGoal>,
    substitutions: Vec<UnitySubstitution>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(default)]
pub(super) struct UnitySubstitution {
    pub minute: u8,
    pub player_off_id: String,
    pub player_on_id: String,
}

pub(super) struct UnityLineup<'a> {
    active: HashMap<&'a str, bool>,
    bench: HashMap<&'a str, bool>,
    remaining: u8,
}

impl<'a> UnityLineup<'a> {
    pub(super) fn new(snapshot: &'a MatchSnapshot, side: Side) -> Self {
        let (team, bench) = match side {
            Side::Home => (&snapshot.home_team, &snapshot.home_bench),
            Side::Away => (&snapshot.away_team, &snapshot.away_bench),
        };
        let roster = |players: &'a [PlayerData]| {
            players
                .iter()
                .map(|p| (p.id.as_str(), p.position == Position::Goalkeeper))
                .collect()
        };
        Self {
            active: roster(&team.players),
            bench: roster(bench),
            remaining: snapshot.max_subs,
        }
    }

    pub(super) fn substitute(&mut self, change: &'a UnitySubstitution) -> Option<()> {
        let off = change.player_off_id.as_str();
        let on = change.player_on_id.as_str();
        let keeper = *self.active.get(off)?;
        if self.remaining == 0 || self.bench.get(on) != Some(&keeper) {
            return None;
        }
        self.remaining -= 1;
        self.active.remove(off);
        self.bench.remove(on);
        self.active.insert(on, keeper);
        Some(())
    }
}

#[derive(Deserialize)]
struct UnityGoal {
    #[serde(default)]
    minute: u8,
    #[serde(default)]
    side: Option<Side>,
    #[serde(default)]
    player_id: String,
}

impl UnityResult {
    fn matches(&self, snapshot: &MatchSnapshot) -> bool {
        let ids = snapshot
            .home_team
            .players
            .iter()
            .chain(&snapshot.away_team.players)
            .map(|p| &p.id);
        snapshot.current_minute == 0
            && !snapshot.allows_extra_time
            && self.home_id == snapshot.home_team.id
            && self.away_id == snapshot.away_team.id
            && self.player_ids.len() == 22
            && self.player_ids.iter().eq(ids)
    }

    fn events(
        &self,
        snapshot: &MatchSnapshot,
        managed: Option<Side>,
        home: u8,
        away: u8,
    ) -> Option<Vec<MatchEvent>> {
        let mut events = Vec::new();
        let mut played: HashMap<&str, (u8, u8)> = HashMap::new();
        if !self.substitutions.is_empty() {
            let side = managed?;
            let mut lineup = UnityLineup::new(snapshot, side);
            played.extend(lineup.active.keys().map(|&id| (id, (1, 90))));
            let mut previous_minute = 1;
            for change in &self.substitutions {
                if !(previous_minute..=90).contains(&change.minute) {
                    return None;
                }
                lineup.substitute(change)?;
                played.get_mut(change.player_off_id.as_str())?.1 = change.minute;
                played.insert(change.player_on_id.as_str(), (change.minute, 90));
                previous_minute = change.minute;
                events.push(
                    MatchEvent::new(change.minute, EventType::Substitution, side, Zone::Midfield)
                        .with_player(&change.player_on_id)
                        .with_secondary(&change.player_off_id),
                );
            }
        }
        let mut remaining = [home, away];
        for goal in &self.goals {
            let side = goal.side?;
            let (team, index) = match side {
                Side::Home => (&snapshot.home_team, 0),
                Side::Away => (&snapshot.away_team, 1),
            };
            remaining[index] = remaining[index].checked_sub(1)?;
            let eligible = if managed == Some(side) && !played.is_empty() {
                played
                    .get(goal.player_id.as_str())
                    .is_some_and(|&(from, to)| (from..=to).contains(&goal.minute))
            } else {
                team.players
                    .iter()
                    .any(|player| player.id == goal.player_id)
            };
            if !(1..=90).contains(&goal.minute) || !eligible {
                return None;
            }
            events.push(
                MatchEvent::new(
                    goal.minute,
                    EventType::Goal,
                    side,
                    Zone::attacking_box(side),
                )
                .with_player(&goal.player_id),
            );
        }
        events.sort_by_key(|event| event.minute);
        Some(events)
    }
}

pub(super) fn apply_result(
    state: &StateManager,
    result: UnityResult,
) -> Result<FinishLiveMatchResponse, String> {
    let (Some(home), Some(away)) = (result.home_goals, result.away_goals) else {
        return Err(INVALID.into());
    };
    if result.version != 1 || result.status != "finished" {
        return Err(INVALID.into());
    }
    let save_id = state.get_save_id();
    let mut events = None;
    let session = state
        .take_live_match_if(|live| {
            let snapshot = live.snapshot();
            if live.external_match_id(save_id.as_deref(), &snapshot) != result.request_id
                || !result.matches(&snapshot)
            {
                return false;
            }
            events = result.events(&snapshot, live.user_side, home, away);
            events.is_some()
        })
        .ok_or(INVALID)?;
    let mut report =
        MatchReport::from_events_with_players(events.ok_or(INVALID)?, 0, 0, 90, result.player_ids);
    report.home_goals = home;
    report.home_stats.goals = home;
    report.away_goals = away;
    report.away_stats.goals = away;
    finish_session(state, session, Some(report))
}

fn bridge_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("OpenFootMatchBridge")
}

#[derive(serde::Serialize)]
pub struct UnityFinishResponse {
    #[serde(flatten)]
    pub(super) finished: FinishLiveMatchResponse,
    home_goals: u8,
    away_goals: u8,
}

#[tauri::command]
pub fn finish_unity_match(
    state: State<'_, Arc<StateManager>>,
) -> Result<UnityFinishResponse, String> {
    import_result(&state)
}

fn result_path(state: &StateManager) -> Result<std::path::PathBuf, String> {
    let save_id = state.get_save_id();
    let id = state
        .with_live_match(|live| live.external_match_id(save_id.as_deref(), &live.snapshot()))
        .ok_or("be.error.noActiveLiveMatch")?;
    Ok(bridge_dir().join(format!("{id}.result.json")))
}

pub(super) fn result_available(state: &StateManager) -> Result<bool, String> {
    Ok(result_path(state)?.is_file())
}

pub(super) fn import_result(state: &StateManager) -> Result<UnityFinishResponse, String> {
    let bytes = std::fs::read(result_path(state)?).map_err(|_| "unityMatch.pending")?;
    let result: UnityResult = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
    let home_goals = result.home_goals.ok_or(INVALID)?;
    let away_goals = result.away_goals.ok_or(INVALID)?;
    Ok(UnityFinishResponse {
        finished: apply_result(state, result)?,
        home_goals,
        away_goals,
    })
}
