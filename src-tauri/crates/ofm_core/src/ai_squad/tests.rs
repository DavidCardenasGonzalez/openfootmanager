use super::*;
use crate::{clock::GameClock, generator, player_rating};
use chrono::{TimeZone, Utc};
use domain::{manager::Manager, player::Position, team::Team};

fn game() -> Game {
    let mut team = Team::new(
        "ai".into(),
        "AI FC".into(),
        "AIF".into(),
        "England".into(),
        "City".into(),
        "Ground".into(),
        10_000,
    );
    team.finance = 5_000_000;
    team.wage_budget = 1_000_000;
    let mut players = Vec::new();
    for (group, count) in [2, 8, 8, 6].into_iter().enumerate() {
        for _ in 0..count {
            let position = [
                Position::Goalkeeper,
                Position::Defender,
                Position::Midfielder,
                Position::Forward,
            ][group]
                .clone();
            let mut player =
                generator::generate_youth_academy_recruit(&team, Some(&position), 2026);
            player.date_of_birth = "2000-01-01".into();
            player.contract_end = Some("2026-08-15".into());
            player.wage = 1_000;
            player_rating::refresh_player_derived(&mut player, 2026);
            players.push(player);
        }
    }
    Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap()),
        Manager::new(
            "user".into(),
            "User".into(),
            "Manager".into(),
            "1980-01-01".into(),
            "England".into(),
        ),
        vec![team],
        players,
        vec![],
        vec![],
    )
}

#[test]
fn ai_renews_needed_expiring_players_without_user_messages() {
    let mut game = game();
    process_ai_squads(&mut game);
    assert!(
        game.players
            .iter()
            .all(|p| p.contract_end.as_deref().unwrap() > "2027-01-01")
    );
    assert!(game.messages.is_empty());
}

#[test]
fn penniless_club_recovers_a_functional_squad_without_spending() {
    let mut game = game();
    game.players.clear();
    game.teams[0].finance = -10_000;
    game.teams[0].wage_budget = 0;
    game.teams[0].transfer_budget = 0;
    process_ai_squads(&mut game);
    assert!(game.players.len() >= MIN_SQUAD_SIZE);
    for (group, minimum) in MIN_POSITION_DEPTH.into_iter().enumerate() {
        assert!(
            game.players
                .iter()
                .filter(|p| crate::transfers::position_group_index(&p.natural_position) == group)
                .count()
                >= minimum
        );
    }
    assert_eq!(game.teams[0].finance, -10_000);
    assert!(
        game.players
            .iter()
            .all(|p| p.wage == 0 && p.contract_end.is_some())
    );
}

#[test]
fn affordable_free_agent_fills_a_vacancy_once() {
    let mut game = game();
    game.players[0].team_id = None;
    game.players[0].contract_end = None;
    game.players[0].market_value = 100_000;
    let id = game.players[0].id.clone();
    process_ai_squads(&mut game);
    process_ai_squads(&mut game);
    let player = game.players.iter().find(|p| p.id == id).unwrap();
    assert_eq!(player.team_id.as_deref(), Some("ai"));
    assert_eq!(player.movement_history.len(), 1);
}

#[test]
fn human_club_is_not_automatically_managed() {
    let mut game = game();
    game.manager.hire("ai".into());
    let before = serde_json::to_value(&game.players).unwrap();
    process_ai_squads(&mut game);
    assert_eq!(serde_json::to_value(&game.players).unwrap(), before);
}

fn add_club(game: &mut Game, id: &str) {
    let template = self::game();
    let mut team = template.teams[0].clone();
    team.id = id.into();
    team.finance = 20_000_000;
    team.transfer_budget = 10_000_000;
    game.teams.push(team);
    for mut p in template.players {
        p.id = format!("{id}-{}", p.id);
        p.team_id = Some(id.into());
        game.players.push(p);
    }
}

#[test]
fn annual_intake_is_bounded_and_survives_json_reload() {
    let mut game = game();
    game.clock.advance_days(365);
    process_ai_squads(&mut game);
    assert_eq!(game.squad_management.totals.youth_intake, 2);
    let count = game.players.len();
    let json = serde_json::to_string(&game).unwrap();
    let mut loaded: Game = serde_json::from_str(&json).unwrap();
    loaded.clock.advance_days(8);
    process_ai_squads(&mut loaded);
    assert_eq!(loaded.squad_management.totals.youth_intake, 2);
    assert_eq!(loaded.players.len(), count);
    assert!(
        loaded
            .players
            .iter()
            .filter(|p| p.id.starts_with("academy-"))
            .all(|p| age(p, loaded.clock.current_date.date_naive()) <= 21)
    );
}

#[test]
fn intake_does_not_overfill_a_club_or_the_world() {
    let mut game = game();
    while game.players.len() < MAX_SQUAD_SIZE {
        let mut p = game.players[0].clone();
        p.id = format!("extra-{}", game.players.len());
        game.players.push(p);
    }
    game.clock.advance_days(365);
    process_ai_squads(&mut game);
    assert_eq!(game.squad_management.totals.youth_intake, 0);
    assert_eq!(game.players.len(), MAX_SQUAD_SIZE);
}

#[test]
fn old_unattached_players_leave_and_archives_are_pruned() {
    let mut game = game();
    let mut p = game.players[0].clone();
    p.id = "unattached".into();
    p.team_id = None;
    game.players.push(p);
    lifecycle::process_inactive_players(&mut game);
    game.clock.advance_days(366);
    lifecycle::process_inactive_players(&mut game);
    assert!(
        game.players
            .iter()
            .find(|p| p.id == "unattached")
            .unwrap()
            .retired
    );
    game.clock.advance_days(731);
    lifecycle::process_inactive_players(&mut game);
    assert!(!game.players.iter().any(|p| p.id == "unattached"));
}

#[test]
fn sell_safety_protects_minimum_size_and_position_depth() {
    let mut game = game();
    let roster = (0..game.players.len()).collect::<Vec<_>>();
    assert!(
        !can_sell(&game, &roster, &game.players[0]),
        "cannot sell one of two keepers"
    );
    game.players.truncate(MIN_SQUAD_SIZE);
    let roster = (0..game.players.len()).collect::<Vec<_>>();
    assert!(game.players.iter().all(|p| !can_sell(&game, &roster, p)));
}

#[test]
fn promotion_and_renewals_never_raise_an_over_budget_wage_bill() {
    let mut game = game();
    game.teams[0].wage_budget = 0;
    let before = crate::finances::calc_annual_wages(&game, "ai");
    process_ai_squads(&mut game);
    assert!(crate::finances::calc_annual_wages(&game, "ai") <= before);
    assert!(
        game.players
            .iter()
            .all(|p| p.squad_role == domain::player::SquadRole::Senior)
    );
}

#[test]
fn dynamic_cap_scales_to_96_clubs_and_stays_bounded() {
    assert_eq!(daily_transfer_limit(4), 2);
    assert_eq!(daily_transfer_limit(96), 6);
    assert_eq!(daily_transfer_limit(1_000), 12);
}

#[test]
fn ai_market_uses_dormant_clubs_and_does_not_flip_an_arrival() {
    use domain::season::TransferWindowStatus;
    let mut game = game();
    add_club(&mut game, "buyer");
    // Isolate market selection from random ratings in generated fixture players.
    for player in &mut game.players {
        player.ovr = 60;
        player.potential = 70;
    }
    game.active_competition_ids = vec!["some-other-division".into()];
    game.season_context.transfer_window.status = TransferWindowStatus::Open;
    let buyer_index = game
        .players
        .iter()
        .position(|p| p.team_id.as_deref() == Some("buyer") && group(p) == 3)
        .unwrap();
    game.players.remove(buyer_index);
    let mut surplus = game
        .players
        .iter()
        .find(|p| p.team_id.as_deref() == Some("ai") && group(p) == 3)
        .unwrap()
        .clone();
    surplus.id = "surplus".into();
    surplus.transfer_listed = true;
    surplus.market_value = 100_000;
    surplus.ovr = 80;
    surplus.potential = 85;
    game.players.push(surplus);
    process_ai_transfer_market(&mut game);
    let p = game.players.iter().find(|p| p.id == "surplus").unwrap();
    assert_eq!(p.team_id.as_deref(), Some("buyer"));
    assert!(p.contract_end.as_deref().unwrap() > "2027-01-01");
    assert!(recently_joined(p, game.clock.current_date.date_naive()));
    let count = game.squad_management.totals.transfers;
    process_ai_transfer_market(&mut game);
    assert_eq!(game.squad_management.totals.transfers, count);
    game.clock.advance_days(8);
    process_ai_squads(&mut game);
    assert!(
        !game
            .players
            .iter()
            .find(|p| p.id == "surplus")
            .unwrap()
            .transfer_listed
    );
}

#[test]
fn unaffordable_target_is_not_bought_and_cash_is_unchanged() {
    use domain::season::TransferWindowStatus;
    let mut game = game();
    add_club(&mut game, "buyer");
    game.teams[1].wage_budget = 1;
    let mut p = game.players[5].clone();
    p.id = "costly".into();
    p.ovr = 95;
    p.transfer_listed = true;
    game.players.push(p);
    game.season_context.transfer_window.status = TransferWindowStatus::Open;
    let cash: Vec<_> = game.teams.iter().map(|t| t.finance).collect();
    process_ai_transfer_market(&mut game);
    assert_eq!(game.squad_management.totals.transfers, 0);
    assert_eq!(
        game.teams.iter().map(|t| t.finance).collect::<Vec<_>>(),
        cash
    );
}

#[test]
fn legacy_json_without_lifecycle_state_loads_with_defaults() {
    let game = game();
    let mut json = serde_json::to_value(&game).unwrap();
    json.as_object_mut().unwrap().remove("squad_management");
    let loaded: Game = serde_json::from_value(json).unwrap();
    assert_eq!(
        serde_json::to_value(loaded.squad_management).unwrap(),
        serde_json::to_value(SquadManagementState::default()).unwrap()
    );
}

#[test]
fn academy_quality_follows_the_actual_club_level_with_ranked_reputation() {
    let mut game = game();
    game.teams[0].reputation = 50; // Open Manager imports use ranks 1..96.
    for p in &mut game.players {
        p.ovr = 80;
    }
    let p = lifecycle::new_prospect(&game, &game.teams[0], 0, "quality-test");
    assert!(
        p.ovr >= 55,
        "a strong XI must not get third-tier recruits because reputation uses another scale"
    );
    assert!(p.potential >= 65);
    let again = lifecycle::new_prospect(&game, &game.teams[0], 0, "quality-test");
    assert_eq!(
        serde_json::to_value(&p).unwrap(),
        serde_json::to_value(&again).unwrap()
    );
}

#[test]
fn small_clubs_can_produce_exceptional_prospects() {
    let mut game = game();
    game.teams[0].reputation = 10;
    let exceptional = (0..256)
        .map(|i| lifecycle::new_prospect(&game, &game.teams[0], i % 4, &format!("talent-{i}")))
        .filter(|p| p.potential >= 90)
        .count();
    assert!(exceptional > 0 && exceptional < 20);
}

#[test]
fn national_callups_cannot_protect_an_unbounded_free_agent_pool() {
    let mut game = game();
    let mut national = domain::national_team::NationalTeam::new(
        "nt-eng".into(),
        "England".into(),
        "ENG".into(),
        Some("europe".into()),
    );
    for p in &mut game.players {
        p.team_id = None;
        national.squad_player_ids.push(p.id.clone());
    }
    game.national_teams.push(national);
    assert_eq!(national_reserves(&game).len(), 2);
}

#[test]
fn injuries_cannot_leave_a_position_group_completely_unplayable() {
    let mut game = game();
    for p in &mut game.players {
        if group(p) == 1 {
            p.injury = Some(domain::player::Injury {
                name: "test".into(),
                days_remaining: 60,
            });
        }
    }
    process_ai_squads(&mut game);
    assert!(
        game.players
            .iter()
            .filter(|p| group(p) == 1 && p.injury.is_none())
            .count()
            >= 3
    );
}

#[test]
fn losing_legacy_scheduling_metadata_cannot_duplicate_a_youth_intake() {
    let mut game = game();
    game.clock.advance_days(365);
    process_ai_squads(&mut game);
    game.squad_management = SquadManagementState::default();
    game.clock.advance_days(8);
    process_ai_squads(&mut game);
    let unique: std::collections::HashSet<_> = game.players.iter().map(|p| &p.id).collect();
    assert_eq!(unique.len(), game.players.len());
}

#[test]
fn retired_legend_archive_is_preserved_but_bounded() {
    let mut game = game();
    game.players.clear();
    for i in 0..60 {
        let mut p = generator::generate_youth_academy_recruit(&game.teams[0], None, 2026);
        p.team_id = None;
        p.retired = true;
        p.id = format!("legend-{i}");
        p.career.push(domain::player::CareerEntry {
            season: 2020,
            team_id: "ai".into(),
            team_name: "AI FC".into(),
            appearances: 100 + i,
            goals: i,
            assists: 0,
        });
        game.players.push(p);
    }
    lifecycle::process_inactive_players(&mut game);
    game.clock.advance_days(731);
    lifecycle::process_inactive_players(&mut game);
    assert_eq!(game.players.len(), 48);
    assert!(game.players.iter().any(|p| p.id == "legend-59"));
}
