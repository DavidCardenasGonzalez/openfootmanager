use crate::application::live_match::{finish_session, ExternalMatchReport, FinishLiveMatchResponse};
use domain::league::{ObservedMatchIncident, ObservedMatchStats, ObservedTeamStats};
use domain::team::TeamKit;
use engine::{
    EventType, MatchEvent, MatchReport, MatchSnapshot, PlayerData, Position, Side, TeamData, Zone,
};
use ofm_core::state::StateManager;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
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
        value["tactics"] = json!(team.tactics);
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
    let mut request = state
        .with_live_match(|live| -> Result<Value, String> {
            let snapshot = live.snapshot();
            if snapshot.current_minute != 0 {
                return Err(INVALID.into());
            }
            Ok(json!({
                "version": 1,
                "use_condition": true,
                "use_balanced_attributes": true,
                "allows_extra_time": snapshot.allows_extra_time,
                "request_id": live.external_match_id(save_id.as_deref(), &snapshot),
                "home": team(&snapshot.home_team, (live.user_side == Some(Side::Home)).then_some(snapshot.home_bench.as_slice()))?,
                "away": team(&snapshot.away_team, (live.user_side == Some(Side::Away)).then_some(snapshot.away_bench.as_slice()))?,
                "max_subs": snapshot.max_subs,
            }))
        })
        .ok_or("be.error.noActiveLiveMatch")??;
    state.get_game(|game| {
        let numbers: HashMap<&str, u8> = game
            .players
            .iter()
            .filter_map(|player| player.jersey_number.map(|number| (player.id.as_str(), number)))
            .collect();
        for side in ["home", "away"] {
            if let Some(club) = game
                .teams
                .iter()
                .find(|club| request[side]["id"].as_str() == Some(club.id.as_str()))
            {
                let mut kits = club.kits.clone();
                if kits.home.is_none() && !club.colors.primary.is_empty() {
                    kits.home = Some(TeamKit {
                        pattern: club.kit_pattern.clone(),
                        colors: club.colors.clone(),
                        unity_mask: None,
                    });
                }
                if kits.home.is_some() || kits.away.is_some() {
                    request[side]["kits"] = json!(kits);
                }
            }
            for group in ["players", "bench"] {
                if let Some(players) = request[side][group].as_array_mut() {
                    for player in players {
                        if let Some(number) = player["id"].as_str().and_then(|id| numbers.get(id)) {
                            player["number"] = json!(number);
                        }
                    }
                }
            }
        }
    });
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
    statistics: Option<ObservedMatchStats>,
    total_minutes: Option<u8>,
    regulation_home_goals: Option<u8>,
    regulation_away_goals: Option<u8>,
    shootout: Vec<UnityShootoutKick>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct UnityShootoutKick {
    side: Option<Side>,
    player_id: String,
    scored: Option<bool>,
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
    #[serde(default)]
    penalty: bool,
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
        statistics: Option<&mut ObservedMatchStats>,
    ) -> Option<Vec<MatchEvent>> {
        let mut events = Vec::new();
        let duration = self.total_minutes.unwrap_or(90);
        let mut played: HashMap<&str, (u8, u8)> = snapshot.home_team.players.iter()
            .chain(&snapshot.away_team.players)
            .map(|player| (player.id.as_str(), (1, duration)))
            .collect();
        if !self.substitutions.is_empty() {
            let side = managed?;
            let mut lineup = UnityLineup::new(snapshot, side);
            let mut previous_minute = 1;
            for change in &self.substitutions {
                if !(previous_minute..=duration).contains(&change.minute) {
                    return None;
                }
                lineup.substitute(change)?;
                played.get_mut(change.player_off_id.as_str())?.1 = change.minute;
                played.insert(change.player_on_id.as_str(), (change.minute, duration));
                previous_minute = change.minute;
                events.push(
                    MatchEvent::new(change.minute, EventType::Substitution, side, Zone::Midfield)
                        .with_player(&change.player_on_id)
                        .with_secondary(&change.player_off_id),
                );
            }
        }
        let home_players = snapshot.home_team.players.iter().chain(&snapshot.home_bench);
        let away_players = snapshot.away_team.players.iter().chain(&snapshot.away_bench);
        let participants: HashMap<&str, (Side, &str)> = home_players
            .map(|player| (player.id.as_str(), (Side::Home, player.name.as_str())))
            .chain(away_players.map(|player| (player.id.as_str(), (Side::Away, player.name.as_str()))))
            .collect();
        let mut penalties: Vec<(&str, u8)> = Vec::new();
        let mut cautioned = HashSet::new();
        let mut dismissed = HashSet::new();
        let mut penalty_goals = Vec::new();
        let mut previous_minute = 1;
        if let Some(stats) = self.statistics.as_ref() {
            for incident in &stats.incidents {
                let id = incident.player_id.as_str();
                let &(side, _) = participants.get(id)?;
                let (from, to) = played.get(id).copied()?;
                if incident.minute < previous_minute || !(from..=to).contains(&incident.minute)
                    || incident.side != if side == Side::Home { "Home" } else { "Away" }
                    || dismissed.contains(id)
                {
                    return None;
                }
                previous_minute = incident.minute;
                let event = match incident.kind.as_str() {
                    "ThrowIn" | "Offside" => continue,
                    "Foul" => EventType::Foul,
                    "YellowCard" if cautioned.insert(id) => EventType::YellowCard,
                    "SecondYellow" | "RedCard" => {
                        if self.substitutions.iter().any(|change| change.player_off_id == id)
                            || (incident.kind == "SecondYellow" && !cautioned.contains(id))
                        {
                            return None;
                        }
                        dismissed.insert(id);
                        played.get_mut(id)?.1 = incident.minute;
                        if incident.kind == "SecondYellow" { EventType::SecondYellow } else { EventType::RedCard }
                    }
                    "PenaltyAwarded" => {
                        penalties.push((id, incident.minute));
                        EventType::PenaltyAwarded
                    }
                    "PenaltyMiss" => {
                        settle_penalty(&mut penalties, id, incident.minute)?;
                        EventType::PenaltyMiss
                    }
                    _ => return None,
                };
                events.push(MatchEvent::new(incident.minute, event, side, Zone::Midfield).with_player(id));
            }
        }
        let mut remaining = [home, away];
        for goal in &self.goals {
            let side = goal.side?;
            let index = if side == Side::Home { 0 } else { 1 };
            remaining[index] = remaining[index].checked_sub(1)?;
            let &(player_side, player_name) = participants.get(goal.player_id.as_str())?;
            let (from, to) = played.get(goal.player_id.as_str()).copied()?;
            if side != player_side || !(from..=to).contains(&goal.minute) {
                return None;
            }
            let kind = if goal.penalty {
                settle_penalty(&mut penalties, &goal.player_id, goal.minute)?;
                penalty_goals.push(ObservedMatchIncident {
                    minute: goal.minute,
                    side: if side == Side::Home { "Home" } else { "Away" }.into(),
                    kind: "PenaltyGoal".into(),
                    player_id: goal.player_id.clone(),
                    player_name: player_name.into(),
                });
                EventType::PenaltyGoal
            } else {
                EventType::Goal
            };
            events.push(
                MatchEvent::new(goal.minute, kind, side, Zone::attacking_box(side)).with_player(&goal.player_id),
            );
        }
        if !penalties.is_empty() {
            return None;
        }
        if !self.shootout.is_empty() {
            let mut eligible = [0usize; 2];
            for (id, &(_, until)) in &played {
                if until == duration && !dismissed.contains(id) && !self.substitutions.iter().any(|change| change.player_off_id == *id) {
                    let (side, _) = participants.get(*id)?;
                    eligible[side_index(*side)] += 1;
                }
            }
            let cycle = eligible[0].min(eligible[1]);
            if cycle == 0 { return None; }
            let mut used = [HashSet::new(), HashSet::new()];
            let mut selected = [HashSet::new(), HashSet::new()];
            for kick in &self.shootout {
                let side = kick.side?;
                let id = kick.player_id.as_str();
                let (player_side, _) = participants.get(id)?;
                let index = side_index(side);
                if *player_side != side || played.get(id)?.1 != duration || dismissed.contains(id)
                    || self.substitutions.iter().any(|change| change.player_off_id == id) {
                    return None;
                }
                if used[index].len() == cycle { used[index].clear(); }
                selected[index].insert(id);
                if selected[index].len() > cycle || !used[index].insert(id) { return None; }
                let kind = if kick.scored? { EventType::ShootoutGoal } else { EventType::ShootoutMiss };
                events.push(MatchEvent::new(120, kind, side, Zone::attacking_box(side)).with_player(id));
            }
        }
        if let Some(stats) = statistics {
            for incident in &mut stats.incidents {
                incident.player_name = participants.get(incident.player_id.as_str())?.1.into();
            }
            stats.incidents.extend(penalty_goals);
            stats.incidents.sort_by_key(|incident| incident.minute);
        }
        events.sort_by_key(|event| event.minute);
        Some(events)
    }

    fn report(
        &self,
        snapshot: &MatchSnapshot,
        managed: Option<Side>,
        home: u8,
        away: u8,
    ) -> Option<ExternalMatchReport> {
        let duration = self.total_minutes.unwrap_or(90);
        match duration {
            90 if self.shootout.is_empty() && (!snapshot.allows_extra_time || home != away) => {},
            120 if snapshot.allows_extra_time => {
                let regulation = self.regulation_home_goals?;
                if self.regulation_away_goals? != regulation || regulation > home.min(away)
                    || (home == away) == self.shootout.is_empty() {
                    return None;
                }
            }
            _ => return None,
        }
        let shootout_score = if self.shootout.is_empty() { None } else { Some(shootout_score(&self.shootout)?) };
        let mut observed_stats = self.statistics.clone();
        let events = self.events(snapshot, managed, home, away, observed_stats.as_mut())?;
        let mut report = MatchReport::from_events_with_players(events, 0, 0, duration, self.player_ids.clone());
        if let Some([home, away]) = shootout_score {
            report.home_penalties = Some(home);
            report.away_penalties = Some(away);
        }
        report.home_goals = home;
        report.home_stats.goals = home;
        report.away_goals = away;
        report.away_stats.goals = away;

        if let Some(stats) = &mut observed_stats {
            match (stats.home.possession_pct, stats.away.possession_pct) {
                (Some(0), Some(0)) => {
                    stats.home.possession_pct = None;
                    stats.away.possession_pct = None;
                }
                (Some(home), Some(away)) if u16::from(home) + u16::from(away) == 100 => {
                    report.home_possession = f64::from(home);
                }
                (None, None) => {}
                _ => return None,
            }
            apply_team_stats(&stats.home, &mut report.home_stats)?;
            apply_team_stats(&stats.away, &mut report.away_stats)?;

            let participants: HashMap<&str, (&str, &PlayerData)> = snapshot
                .home_team
                .players
                .iter()
                .chain(&snapshot.home_bench)
                .map(|player| (player.id.as_str(), ("Home", player)))
                .chain(
                    snapshot.away_team.players.iter()
                        .chain(&snapshot.away_bench)
                        .map(|player| (player.id.as_str(), ("Away", player))),
                )
                .collect();
            let mut seen = HashSet::new();
            for player in &mut stats.players {
                let &(side, participant) = participants.get(player.player_id.as_str())?;
                let team = if side == "Home" { &stats.home } else { &stats.away };
                if !seen.insert(player.player_id.as_str())
                    || player.shots_on_target > player.shots
                    || player.passes_completed > player.passes_attempted
                    || player.shots > team.shots
                    || player.shots_on_target > team.shots_on_target
                    || player.passes_attempted > team.passes_attempted
                    || player.passes_completed > team.passes_completed
                    || player.saves > team.saves
                {
                    return None;
                }
                let row = report.player_stats.get_mut(&player.player_id)?;
                player.side = side.into();
                player.player_name.clone_from(&participant.name);
                player.minutes_played = row.minutes_played;
                if stats.condition_tracked {
                    let remaining = player.condition_end?;
                    row.condition_depletion = Some(participant.condition.min(100).checked_sub(remaining)?);
                } else {
                    player.condition_end = None;
                }
                let narrow = |count| u8::try_from(count).unwrap_or(u8::MAX);
                row.shots = narrow(player.shots);
                row.shots_on_target = narrow(player.shots_on_target);
                row.passes_completed = narrow(player.passes_completed);
                row.passes_attempted = narrow(player.passes_attempted);
            }
        }
        Some(ExternalMatchReport {
            report,
            observed_stats,
        })
    }
}

fn side_index(side: Side) -> usize {
    usize::from(side == Side::Away)
}

fn shootout_score(kicks: &[UnityShootoutKick]) -> Option<[u8; 2]> {
    let first = side_index(kicks.first()?.side?);
    let mut taken = [0usize; 2];
    let mut scored = [0u8; 2];
    for (index, kick) in kicks.iter().enumerate() {
        let side = side_index(kick.side?);
        if side != (first + index) % 2 { return None; }
        taken[side] += 1;
        scored[side] = scored[side].checked_add(u8::from(kick.scored?))?;
        let [home, away] = scored.map(usize::from);
        let decided = if taken[0].max(taken[1]) <= 5 {
            home > away + 5 - taken[1] || away > home + 5 - taken[0]
        } else {
            taken[0] == taken[1] && home != away
        };
        if decided { return (index + 1 == kicks.len()).then_some(scored); }
    }
    None
}

#[cfg(test)]
mod knockout_tests {
    use super::*;

    #[test]
    fn unity_shootout_requires_equal_attempts_in_sudden_death() {
        let kick = |side, scored| UnityShootoutKick {
            side: Some(side),
            scored: Some(scored),
            ..UnityShootoutKick::default()
        };
        let mut kicks = Vec::new();
        for _ in 0..5 {
            kicks.extend([kick(Side::Home, true), kick(Side::Away, true)]);
        }
        assert_eq!(shootout_score(&kicks), None);
        kicks.push(kick(Side::Home, false));
        assert_eq!(shootout_score(&kicks), None);
        kicks.push(kick(Side::Away, true));
        assert_eq!(shootout_score(&kicks), Some([5, 6]));
        kicks.push(kick(Side::Home, true));
        assert_eq!(shootout_score(&kicks), None);
    }
}

fn settle_penalty(penalties: &mut Vec<(&str, u8)>, taker: &str, minute: u8) -> Option<()> {
    let index = penalties.iter().position(|&(id, awarded)| id == taker && awarded <= minute)?;
    penalties.remove(index);
    Some(())
}

fn apply_team_stats(stats: &ObservedTeamStats, target: &mut engine::TeamStats) -> Option<()> {
    if stats.shots_on_target > stats.shots || stats.passes_completed > stats.passes_attempted {
        return None;
    }
    target.possession_ticks = u32::from(stats.possession_pct.unwrap_or(0));
    target.shots = stats.shots;
    target.shots_on_target = stats.shots_on_target;
    target.passes_completed = stats.passes_completed;
    // The engine stores incomplete passes in this bucket when computing accuracy.
    target.passes_intercepted = stats.passes_attempted - stats.passes_completed;
    target.corners = stats.corners;
    Some(())
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
    let mut report = None;
    let session = state
        .take_live_match_if(|live| {
            let snapshot = live.snapshot();
            if live.external_match_id(save_id.as_deref(), &snapshot) != result.request_id
                || !result.matches(&snapshot)
            {
                return false;
            }
            report = result.report(&snapshot, live.user_side, home, away);
            report.is_some()
        })
        .ok_or(INVALID)?;
    finish_session(state, session, Some(report.ok_or(INVALID)?))
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
