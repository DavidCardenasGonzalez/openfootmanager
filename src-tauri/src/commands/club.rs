use log::info;
use std::sync::Arc;
use tauri::State;

use ofm_core::finances::{self, FinanceHealthLevel};
use ofm_core::game::Game;
use ofm_core::state::StateManager;

use crate::commands::util::mutate_active_game;

pub fn get_academy_internal(
    state: &StateManager,
) -> Result<ofm_core::academy::AcademyView, String> {
    state
        .update_game(|game| {
            ofm_core::academy::process_human_intake(game);
            ofm_core::academy::view(game).ok_or_else(|| "be.error.noTeamAssigned".to_string())
        })
        .ok_or_else(|| "be.error.noActiveGameSession".to_string())?
}

#[tauri::command]
pub fn get_academy(
    state: State<'_, Arc<StateManager>>,
) -> Result<ofm_core::academy::AcademyView, String> {
    get_academy_internal(&state)
}

pub fn sign_academy_candidate_internal(
    state: &StateManager,
    candidate_id: &str,
) -> Result<Game, String> {
    mutate_active_game(state, |game| {
        ofm_core::academy::sign_candidate(game, candidate_id)
    })
}

#[tauri::command]
pub fn sign_academy_candidate(
    state: State<'_, Arc<StateManager>>,
    candidate_id: String,
) -> Result<Game, String> {
    sign_academy_candidate_internal(&state, &candidate_id)
}

pub fn reject_academy_candidate_internal(
    state: &StateManager,
    candidate_id: &str,
) -> Result<Game, String> {
    mutate_active_game(state, |game| {
        ofm_core::academy::reject_candidate(game, candidate_id)
    })
}

#[tauri::command]
pub fn reject_academy_candidate(
    state: State<'_, Arc<StateManager>>,
    candidate_id: String,
) -> Result<Game, String> {
    reject_academy_candidate_internal(&state, &candidate_id)
}

#[tauri::command]
pub fn upgrade_facility(
    state: State<'_, Arc<StateManager>>,
    facility: String,
) -> Result<Game, String> {
    upgrade_facility_internal(&state, &facility)
}

pub fn upgrade_facility_internal(state: &StateManager, facility: &str) -> Result<Game, String> {
    info!("[cmd] upgrade_facility: {}", facility);
    // All checks (team, facility type, finance health, ofm_core's funds check)
    // precede any mutation, so in-place mutation is safe.
    mutate_active_game(state, |game| {
        let team_id = game
            .manager
            .team_id
            .clone()
            .ok_or("be.error.noTeamAssigned".to_string())?;

        let facility_type = match facility {
            "Youth" => domain::team::FacilityType::Youth,
            "Training" => domain::team::FacilityType::Training,
            "Medical" => domain::team::FacilityType::Medical,
            "Scouting" => domain::team::FacilityType::Scouting,
            _ => return Err("be.error.unknownFacilityType".to_string()),
        };

        let snapshot = finances::team_finance_snapshot(game, &team_id)
            .ok_or("be.error.managedTeamNotFound".to_string())?;
        if snapshot.currently_over_budget {
            return Err("be.error.finance.facilityUpgradeOverBudget".to_string());
        }
        if matches!(
            snapshot.overall_status,
            FinanceHealthLevel::Warning | FinanceHealthLevel::Critical
        ) {
            return Err("be.error.finance.facilityUpgradeCritical".to_string());
        }

        ofm_core::club::upgrade_facility(game, &team_id, facility_type)?;

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::upgrade_facility_internal;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::player::{Player, PlayerAttributes, Position};
    use domain::team::Team;
    use ofm_core::clock::GameClock;
    use ofm_core::game::Game;
    use ofm_core::state::StateManager;

    #[test]
    fn maximum_training_facility_cannot_charge_for_an_ineffective_upgrade() {
        let state = StateManager::new();
        let mut game = make_game();
        game.teams[0].facilities.training = 5;
        state.set_game(game);
        assert_eq!(
            upgrade_facility_internal(&state, "Training").unwrap_err(),
            "academy.maxLevelError"
        );
    }

    #[test]
    fn academy_commands_keep_candidates_out_of_the_world_until_signed() {
        let state = StateManager::new();
        state.set_game(make_game());
        let view = super::get_academy_internal(&state).unwrap();
        assert_eq!(view.candidates.len(), 6);
        assert!(!serde_json::to_string(&view)
            .unwrap()
            .contains("\"potential\":"));
        let before = state.get_game(|g| g.players.len()).unwrap();
        let updated =
            super::sign_academy_candidate_internal(&state, &view.candidates[0].id).unwrap();
        assert_eq!(updated.players.len(), before + 1);
        assert_eq!(
            super::get_academy_internal(&state)
                .unwrap()
                .signings_remaining,
            1
        );
    }

    fn default_attrs() -> PlayerAttributes {
        PlayerAttributes {
            pace: 60,
            stamina: 60,
            strength: 60,
            agility: 60,
            passing: 60,
            shooting: 60,
            tackling: 60,
            dribbling: 60,
            defending: 60,
            positioning: 60,
            vision: 60,
            decisions: 60,
            composure: 60,
            aggression: 60,
            teamwork: 60,
            leadership: 60,
            handling: 30,
            reflexes: 30,
            aerial: 60,
        }
    }

    fn make_player(id: &str, team_id: &str, wage: u32) -> Player {
        let mut player = Player::new(
            id.to_string(),
            "Player".to_string(),
            "Player".to_string(),
            "1995-01-01".to_string(),
            "England".to_string(),
            Position::Forward,
            default_attrs(),
        );
        player.team_id = Some(team_id.to_string());
        player.wage = wage;
        player
    }

    fn make_team() -> Team {
        let mut team = Team::new(
            "team-1".to_string(),
            "User FC".to_string(),
            "USR".to_string(),
            "England".to_string(),
            "London".to_string(),
            "User Ground".to_string(),
            25_000,
        );
        team.finance = 1_000_000;
        team.manager_id = Some("manager-1".to_string());
        team
    }

    fn make_game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "manager-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team-1".to_string());

        Game::new(clock, manager, vec![make_team()], vec![], vec![], vec![])
    }

    #[test]
    fn upgrade_facility_internal_updates_state() {
        let state = StateManager::new();
        state.set_game(make_game());

        let response = upgrade_facility_internal(&state, "Medical").expect("response");
        let team = response
            .teams
            .iter()
            .find(|team| team.id == "team-1")
            .unwrap();

        assert_eq!(team.facilities.medical, 2);
        assert_eq!(team.finance, 750_000);

        let stored_game = state.get_game(|game| game.clone()).expect("stored game");
        let stored_team = stored_game
            .teams
            .iter()
            .find(|team| team.id == "team-1")
            .expect("stored team should exist");
        assert_eq!(stored_team.facilities.medical, 2);
        assert_eq!(stored_team.finance, 750_000);
    }

    #[test]
    fn upgrade_facility_internal_rejects_over_budget_clubs() {
        let state = StateManager::new();
        let mut game = make_game();
        game.teams[0].wage_budget = 100_000;
        game.players
            .push(make_player("player-1", "team-1", 220_000));
        state.set_game(game);

        let error = upgrade_facility_internal(&state, "Training").expect_err("should fail");

        assert_eq!(error, "be.error.finance.facilityUpgradeOverBudget");

        let stored_game = state
            .get_game(|current| current.clone())
            .expect("stored game");
        let stored_team = stored_game
            .teams
            .iter()
            .find(|team| team.id == "team-1")
            .expect("stored team should exist");
        assert_eq!(stored_team.facilities.training, 1);
        assert_eq!(stored_team.finance, 1_000_000);
    }

    #[test]
    fn upgrade_facility_internal_rejects_warning_finance_clubs() {
        let state = StateManager::new();
        let mut game = make_game();
        game.teams[0].finance = 40_000;
        game.teams[0].wage_budget = 1_000_000;
        game.players
            .push(make_player("player-1", "team-1", 260_000));
        state.set_game(game);

        let error = upgrade_facility_internal(&state, "Medical").expect_err("should fail");

        assert_eq!(error, "be.error.finance.facilityUpgradeCritical");
    }
}
