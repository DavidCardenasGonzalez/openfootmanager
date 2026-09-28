use super::*;
use crate::{clock::GameClock, generator};
use chrono::{TimeZone, Utc};
use domain::{manager::Manager, team::Team};

fn game(level: u8) -> Game {
    let mut team = Team::new(
        "club".into(),
        "Club".into(),
        "CLU".into(),
        "England".into(),
        "City".into(),
        "Ground".into(),
        10000,
    );
    team.facilities.youth = level;
    team.finance = 5_000_000;
    team.wage_budget = 2_000_000;
    let mut manager = Manager::new(
        "user".into(),
        "User".into(),
        "Manager".into(),
        "1980-01-01".into(),
        "England".into(),
    );
    manager.hire(team.id.clone());
    Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap()),
        manager,
        vec![team],
        vec![],
        vec![],
        vec![],
    )
}

#[test]
fn candidates_are_opportunities_not_world_players_and_reload_cannot_reroll() {
    let mut g = game(5);
    process_human_intake(&mut g);
    assert_eq!(g.squad_management.academies["club"].candidates.len(), 14);
    assert!(g.players.is_empty());
    assert_eq!(g.messages.len(), 1);
    let before = serde_json::to_value(&g.squad_management).unwrap();
    let mut loaded: Game = serde_json::from_str(&serde_json::to_string(&g).unwrap()).unwrap();
    process_human_intake(&mut loaded);
    assert_eq!(loaded.messages.len(), 1);
    assert_eq!(
        before,
        serde_json::to_value(&loaded.squad_management).unwrap()
    );
}

#[test]
fn signing_charges_money_uses_a_place_and_obeys_shared_yearly_quota() {
    let mut g = game(1);
    process_human_intake(&mut g);
    let ids: Vec<_> = g.squad_management.academies["club"]
        .candidates
        .iter()
        .map(|c| c.player.id.clone())
        .collect();
    let fee = g.squad_management.academies["club"].candidates[0].signing_fee;
    sign_candidate(&mut g, &ids[0]).unwrap();
    assert_eq!(g.teams[0].finance, 5_000_000 - fee);
    assert_eq!(g.players.len(), 1);
    assert!(g.players[0].contract_end.is_some());
    assert!(sign_candidate(&mut g, &ids[0]).is_err());
    sign_candidate(&mut g, &ids[1]).unwrap();
    assert_eq!(
        sign_candidate(&mut g, &ids[2]).unwrap_err(),
        "academy.quotaError"
    );
}

#[test]
fn rejecting_and_expiring_candidates_never_creates_free_agents() {
    let mut g = game(1);
    process_human_intake(&mut g);
    let id = g.squad_management.academies["club"].candidates[0]
        .player
        .id
        .clone();
    reject_candidate(&mut g, &id).unwrap();
    assert_eq!(g.squad_management.academies["club"].candidates.len(), 5);
    g.clock.advance_days(181);
    process_human_intake(&mut g);
    assert!(g.squad_management.academies["club"].candidates.is_empty());
    assert!(g.players.is_empty());
}

#[test]
fn full_roster_and_salary_limit_reject_without_charging_or_resolving() {
    let mut g = game(3);
    process_human_intake(&mut g);
    let id = g.squad_management.academies["club"].candidates[0]
        .player
        .id
        .clone();
    for _ in 0..28 {
        g.players.push(generator::generate_youth_academy_recruit(
            &g.teams[0],
            None,
            2026,
        ));
    }
    let cash = g.teams[0].finance;
    assert_eq!(
        sign_candidate(&mut g, &id).unwrap_err(),
        "academy.rosterError"
    );
    assert_eq!(g.teams[0].finance, cash);
    g.players.clear();
    g.teams[0].wage_budget = 0;
    assert_eq!(
        sign_candidate(&mut g, &id).unwrap_err(),
        "academy.wageError"
    );
    assert_eq!(g.squad_management.academies["club"].signed, 0);
}

#[test]
fn academy_improvement_increases_consistency_without_guaranteeing_elite() {
    let low = game(1);
    let high = game(5);
    let mut low_total = 0_u64;
    let mut high_total = 0_u64;
    let mut low_elite = 0;
    let mut high_elite = 0;
    for cycle in 0..500 {
        for (g, total, elite) in [
            (&low, &mut low_total, &mut low_elite),
            (&high, &mut high_total, &mut high_elite),
        ] {
            let pool = generate_candidates(g, &g.teams[0], cycle);
            *total += pool.iter().map(|c| u64::from(c.player.ovr)).sum::<u64>();
            *elite += pool.iter().filter(|c| c.player.potential >= 90).count();
            assert!(
                pool.iter()
                    .all(|c| (35..=72).contains(&c.player.ovr) && c.player.potential <= 95)
            );
            assert!(pool.iter().any(|c| c.player.potential >= 65));
        }
    }
    assert!(high_total as f64 / (500.0 * 14.0) > low_total as f64 / (500.0 * 6.0) + 4.0);
    assert!(low_elite > 0);
    assert!(high_elite > low_elite && high_elite < 140);
}

#[test]
fn switching_clubs_cannot_reset_the_clubs_seasonal_budget() {
    let mut g = game(1);
    process_human_intake(&mut g);
    let id = g.squad_management.academies["club"].candidates[0]
        .player
        .id
        .clone();
    sign_candidate(&mut g, &id).unwrap();
    g.manager.team_id = None;
    process_human_intake(&mut g);
    g.manager.team_id = Some("club".into());
    process_human_intake(&mut g);
    assert_eq!(g.squad_management.academies["club"].signed, 1);
}

#[test]
fn scouted_reports_share_supply_and_cannot_resurrect_a_rejected_candidate() {
    let mut g = game(1);
    let found = scout_candidates(&mut g, None, None);
    assert_eq!(found.len(), 3);
    assert!(scout_candidates(&mut g, None, None).is_empty());
    reject_candidate(&mut g, &found[0].id).unwrap();
    assert!(sign_report_candidate(&mut g, &found[0]).is_err());
    sign_report_candidate(&mut g, &found[1]).unwrap();
    let id = g.squad_management.academies["club"].candidates[0]
        .player
        .id
        .clone();
    sign_candidate(&mut g, &id).unwrap();
    assert_eq!(
        sign_report_candidate(&mut g, &found[2]).unwrap_err(),
        "academy.quotaError"
    );
}

#[test]
fn improvements_do_not_reroll_the_existing_intake_and_quotas_reset_next_season() {
    let mut g = game(1);
    process_human_intake(&mut g);
    let ids: Vec<_> = g.squad_management.academies["club"]
        .candidates
        .iter()
        .map(|c| c.player.id.clone())
        .collect();
    sign_candidate(&mut g, &ids[0]).unwrap();
    g.teams[0].facilities.youth = 5;
    process_human_intake(&mut g);
    assert_eq!(view(&g).unwrap().signing_limit, 2);
    assert_eq!(view(&g).unwrap().next_signings, 4);
    g.clock.advance_days(365);
    process_human_intake(&mut g);
    assert_eq!(view(&g).unwrap().candidates.len(), 14);
    assert_eq!(view(&g).unwrap().signings_remaining, 4);
    assert!(
        g.squad_management.academies["club"]
            .candidates
            .iter()
            .all(|c| !ids.contains(&c.player.id))
    );
}

#[test]
fn imported_maximum_training_is_not_a_maximum_academy() {
    let mut g = game(1);
    g.teams[0].facilities.training = 5;
    assert_eq!(level(&g.teams[0]), 1);
    let old: domain::team::Facilities =
        serde_json::from_str(r#"{"training":5,"medical":5,"scouting":5}"#).unwrap();
    assert_eq!(old.youth, 1);
}

#[test]
fn separate_careers_have_different_generations_for_the_same_club() {
    let first = game(3);
    let mut second = game(3);
    second.manager_id = "another-career-manager".into();
    let potentials = |g: &Game| {
        generate_candidates(g, &g.teams[0], 0)
            .into_iter()
            .map(|c| c.player.potential)
            .collect::<Vec<_>>()
    };
    assert_ne!(potentials(&first), potentials(&second));
}

#[test]
fn youth_facilities_can_only_be_improved_once_per_season() {
    let mut g = game(1);
    crate::club::upgrade_facility(&mut g, "club", domain::team::FacilityType::Youth).unwrap();
    assert_eq!(g.teams[0].facilities.youth, 2);
    assert_eq!(
        crate::club::upgrade_facility(&mut g, "club", domain::team::FacilityType::Youth)
            .unwrap_err(),
        "academy.upgradeError"
    );
    g.clock.advance_days(365);
    crate::club::upgrade_facility(&mut g, "club", domain::team::FacilityType::Youth).unwrap();
    assert_eq!(g.teams[0].facilities.youth, 3);
}
