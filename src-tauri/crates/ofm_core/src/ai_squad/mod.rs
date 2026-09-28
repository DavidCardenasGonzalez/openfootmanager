//! Low-cost, world-wide squad planning for clubs not controlled by the user.
//!
//! Weekly reviews plan exits and renewals. Daily safety repairs and window-only
//! recruitment use the same depth and affordability rules, including dormant clubs.
use crate::game::Game;
use chrono::{Datelike, NaiveDate};
use domain::player::{Player, Position};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

mod lifecycle;
mod market;
mod policy;
use policy::*;

pub const MIN_SQUAD_SIZE: usize = 22;
pub const TARGET_SQUAD_SIZE: usize = 24;
pub const MAX_SQUAD_SIZE: usize = 28;
pub const MIN_POSITION_DEPTH: [usize; 4] = [2, 6, 6, 4];
pub const MIN_HEALTHY_POSITION_DEPTH: [usize; 4] = [1, 3, 3, 2];
const TARGET_POSITION_DEPTH: [usize; 4] = [2, 8, 8, 6];

/// Small persisted ledger: save/load must not repeat reviews or annual intakes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SquadManagementState {
    #[serde(default)]
    pub academies: BTreeMap<String, crate::academy::AcademyIntake>,
    #[serde(default)]
    pub academy_upgrades: BTreeMap<String, u32>,
    #[serde(default)]
    pub last_processed_date: Option<String>,
    #[serde(default)]
    pub last_review_week: Option<String>,
    #[serde(default)]
    pub last_market_date: Option<String>,
    #[serde(default)]
    pub last_intake_cycle: u32,
    #[serde(default)]
    pub opening_season: Option<u32>,
    #[serde(default)]
    pub inactive_since: BTreeMap<String, String>,
    #[serde(default)]
    pub totals: SquadManagementTotals,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SquadManagementTotals {
    #[serde(default)]
    pub renewals: u64,
    #[serde(default)]
    pub transfers: u64,
    #[serde(default)]
    pub free_agent_signings: u64,
    #[serde(default)]
    pub youth_intake: u64,
    #[serde(default)]
    pub emergency_recruits: u64,
    #[serde(default)]
    pub international_recruits: u64,
    #[serde(default)]
    pub promotions: u64,
    #[serde(default)]
    pub departures: u64,
    #[serde(default)]
    pub retirements: u64,
    #[serde(default)]
    pub archived_players: u64,
}

pub fn process_ai_squads(game: &mut Game) {
    crate::academy::process_human_intake(game);
    let date = game.clock.current_date.date_naive();
    let today = date.to_string();
    if game.squad_management.last_processed_date.as_deref() == Some(&today) {
        return;
    }
    if game.squad_management.opening_season.is_none() {
        game.squad_management.opening_season = game.primary_competition().map(|c| c.season);
    }
    let week = date.format("%G-%V").to_string();
    if game.squad_management.last_review_week.as_deref() != Some(&week) {
        lifecycle::process_inactive_players(game);
        let rosters = roster_indices(game);
        for team_id in ai_club_ids(game) {
            lifecycle::review_club(
                game,
                &team_id,
                rosters.get(&team_id).map(Vec::as_slice).unwrap_or(&[]),
            );
        }
        game.squad_management.last_review_week = Some(week);
    }
    lifecycle::annual_intake(game);
    // Runs before expiry and after expiry in the turn loop. Needed renewals are
    // weekly; expiry losses are repaired the same day by the safety pass below.
    repair_squads(game);
    game.squad_management.last_processed_date = Some(today);
}

pub(crate) fn repair_squads(game: &mut Game) {
    let rosters = roster_indices(game);
    for team_id in ai_club_ids(game) {
        lifecycle::fill_vacancies(
            game,
            &team_id,
            rosters.get(&team_id).cloned().unwrap_or_default(),
        );
    }
}

pub(crate) fn process_ai_transfer_market(game: &mut Game) {
    market::shop(game);
}

pub fn daily_transfer_limit(clubs: usize) -> usize {
    clubs.div_ceil(16).clamp(2, 12)
}

fn roster_indices(game: &Game) -> HashMap<String, Vec<usize>> {
    let mut rosters: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, player) in game.players.iter().enumerate() {
        if !player.retired
            && let Some(id) = &player.team_id
        {
            rosters.entry(id.clone()).or_default().push(index);
        }
    }
    rosters
}

fn ai_club_ids(game: &Game) -> Vec<String> {
    let mut ids: Vec<_> = game
        .teams
        .iter()
        .filter(|t| Some(t.id.as_str()) != game.manager.team_id.as_deref())
        .map(|t| t.id.clone())
        .collect();
    ids.sort();
    // Deterministic rotation avoids giving the first clubs every scarce signing.
    if !ids.is_empty() {
        let offset = game.clock.current_date.date_naive().num_days_from_ce() as usize % ids.len();
        ids.rotate_left(offset);
    }
    ids
}

fn group(player: &Player) -> usize {
    crate::transfers::position_group_index(&player.natural_position)
}

fn group_position(index: usize) -> Position {
    [
        Position::Goalkeeper,
        Position::Defender,
        Position::Midfielder,
        Position::Forward,
    ][index]
        .clone()
}

fn age(player: &Player, date: NaiveDate) -> i32 {
    NaiveDate::parse_from_str(&player.date_of_birth, "%Y-%m-%d")
        .map(|dob| date.years_since(dob).unwrap_or(0) as i32)
        .unwrap_or(30)
}

#[cfg(test)]
mod tests;
