//! Development stress runner: real daily turns and season rollover, scoreline-only
//! matches. No human club, no injected cash and no roster repairs in this harness.
//! cargo run --manifest-path src-tauri/Cargo.toml -p ofm_core --example squad_lifecycle -- 20
use chrono::{Datelike, TimeZone, Utc};
use domain::{manager::Manager, player::PlayerMovementKind};
use ofm_core::{
    ai_squad, clock::GameClock, end_of_season, game::Game, generator, schedule, season_context,
    turn,
};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

fn snapshot(game: &Game, season: u32) -> serde_json::Value {
    let mut sizes = Vec::new();
    let mut below = 0;
    let mut missing = 0;
    let mut unhealthy = 0;
    let mut over = 0;
    for team in &game.teams {
        let roster: Vec<_> = game
            .players
            .iter()
            .filter(|p| !p.retired && p.team_id.as_deref() == Some(&team.id))
            .collect();
        sizes.push(roster.len());
        below += usize::from(roster.len() < ai_squad::MIN_SQUAD_SIZE);
        over += usize::from(roster.len() > ai_squad::MAX_SQUAD_SIZE);
        let mut depths = [0; 4];
        let mut healthy_depths = [0; 4];
        for p in &roster {
            let g = match p.natural_position.to_group_position() {
                domain::player::Position::Goalkeeper => 0,
                domain::player::Position::Defender => 1,
                domain::player::Position::Midfielder => 2,
                _ => 3,
            };
            depths[g] += 1;
            if p.injury.is_none() {
                healthy_depths[g] += 1;
            }
        }
        unhealthy += usize::from(
            (0..4).any(|g| healthy_depths[g] < ai_squad::MIN_HEALTHY_POSITION_DEPTH[g])
                || healthy_depths.iter().sum::<usize>() < 11,
        );
        missing += usize::from((0..4).any(|g| depths[g] < ai_squad::MIN_POSITION_DEPTH[g]));
    }
    let active: Vec<_> = game.players.iter().filter(|p| !p.retired).collect();
    let ages: f64 = active
        .iter()
        .map(|p| {
            chrono::NaiveDate::parse_from_str(&p.date_of_birth, "%Y-%m-%d")
                .map(|dob| {
                    game.clock
                        .current_date
                        .date_naive()
                        .years_since(dob)
                        .unwrap_or(0) as f64
                })
                .unwrap_or(0.0)
        })
        .sum();
    let mut movements = HashSet::new();
    let mut duplicate_moves = 0;
    for p in &game.players {
        for e in &p.movement_history {
            if e.kind == PlayerMovementKind::PermanentTransfer
                && !movements.insert((p.id.clone(), e.date.clone()))
            {
                duplicate_moves += 1;
            }
        }
    }
    let ids: HashSet<_> = game.players.iter().map(|p| &p.id).collect();
    let totals = &game.squad_management.totals;
    serde_json::json!({
        "season": season, "date": game.clock.current_date.date_naive().to_string(), "clubs": game.teams.len(),
        "total_players": game.players.len(), "active_players": active.len(),
        "free_agents": active.iter().filter(|p| p.team_id.is_none()).count(),
        "retired_in_archive": game.players.len() - active.len(), "archived_players": totals.archived_players,
        "departures": totals.departures, "retirements": totals.retirements, "youth_intake": totals.youth_intake,
        "emergency_recruits": totals.emergency_recruits, "international_recruits": totals.international_recruits, "promotions": totals.promotions,
        "transfers": totals.transfers, "renewals": totals.renewals, "free_agent_signings": totals.free_agent_signings,
        "min_squad": sizes.iter().min(), "max_squad": sizes.iter().max(), "mean_squad": sizes.iter().sum::<usize>() as f64 / sizes.len() as f64,
        "mean_age": ages / active.len().max(1) as f64,
        "mean_ovr": active.iter().map(|p| f64::from(p.ovr)).sum::<f64>() / active.len().max(1) as f64,
        "mean_potential": active.iter().map(|p| f64::from(p.potential)).sum::<f64>() / active.len().max(1) as f64,
        "players_80_plus": active.iter().filter(|p| p.ovr >= 80).count(),
        "players_90_plus": active.iter().filter(|p| p.ovr >= 90).count(),
        "potential_80_plus": active.iter().filter(|p| p.potential >= 80).count(),
        "potential_90_plus": active.iter().filter(|p| p.potential >= 90).count(),
        "ovr_distribution": ([0_u8,50,60,70,80,90].map(|lo| active.iter().filter(|p| p.ovr >= lo && p.ovr < if lo==0 {50} else {lo+10}).count())),
        "potential_distribution": ([0_u8,50,60,70,80,90].map(|lo| active.iter().filter(|p| p.potential >= lo && p.potential < if lo==0 {50} else {lo+10}).count())),
        "clubs_below_minimum": below, "clubs_missing_healthy_positions": unhealthy, "clubs_missing_positions": missing, "clubs_above_maximum": over,
        "duplicate_ids": game.players.len() - ids.len(), "duplicate_moves": duplicate_moves,
        "club_players_without_contract": active.iter().filter(|p| p.team_id.is_some() && p.contract_end.is_none()).count(),
        "mean_cash": game.teams.iter().map(|t| t.finance as f64).sum::<f64>() / game.teams.len() as f64,
        "mean_transfer_budget": game.teams.iter().map(|t| t.transfer_budget as f64).sum::<f64>() / game.teams.len() as f64,
        "negative_cash_clubs": game.teams.iter().filter(|t| t.finance < 0).count(),
    })
}

fn main() {
    let years: u32 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(20);
    let path = std::env::args().nth(2).unwrap_or_else(|| {
        format!(
            "{}/../../../data/open-manager/world.json",
            env!("CARGO_MANIFEST_DIR")
        )
    });
    let mut world = generator::load_world_from_path(Path::new(&path)).expect("valid world");
    generator::normalize_imported_world_for_career_start(&mut world, 2026);
    // Five connected divisions of up to 20 clubs exercise the current 96-club universe.
    // Production promotion/relegation and reputation rules run at each rollover.
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "observer".into(),
        "World".into(),
        "Observer".into(),
        "1980-01-01".into(),
        "England".into(),
    );
    let mut game = Game::new(
        clock,
        manager,
        world.teams,
        world.players,
        world.staff,
        vec![],
    );
    for (tier, teams) in game.teams.chunks(20).enumerate() {
        let ids: Vec<_> = teams.iter().map(|t| t.id.clone()).collect();
        let mut league = schedule::generate_league(
            &format!("Validation Division {}", tier + 1),
            2026,
            &ids,
            Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap(),
        );
        league.priority = tier as u32 + 1;
        league.country_id = Some("open-manager".into());
        league.region_id = Some("europe".into());
        game.competitions.push(league);
    }
    game.sync_legacy_league();
    // A deliberately empty active scope sends fixtures through the existing
    // dormant scoreline path. The roster policy must still manage every club.
    game.active_competition_ids = vec!["validation-scorelines-only".into()];
    season_context::refresh_game_context(&mut game);
    let initial_population = game.players.len() as f64;
    println!("{}", snapshot(&game, 0));
    let started = std::time::Instant::now();
    let mut per_day_max = 0;
    let mut deficits = 0;
    let mut bad_transfers = 0;
    for year in 1..=years {
        let initial_season = game.primary_competition().unwrap().season;
        let mut days = 0;
        loop {
            let wages: HashMap<_, _> = game
                .teams
                .iter()
                .map(|t| {
                    (
                        t.id.clone(),
                        (
                            ofm_core::finances::calc_annual_wages(&game, &t.id),
                            t.wage_budget,
                        ),
                    )
                })
                .collect();
            let transfers = game.squad_management.totals.transfers;
            turn::process_day(&mut game);
            let daily = (game.squad_management.totals.transfers - transfers) as usize;
            per_day_max = per_day_max.max(daily);
            assert!(daily <= ai_squad::daily_transfer_limit(game.teams.len()));
            // The new policy cannot increase an existing salary-budget violation.
            for team in &game.teams {
                let (old, budget) = wages[&team.id];
                let new = ofm_core::finances::calc_annual_wages(&game, &team.id);
                if new > budget.max(old) {
                    bad_transfers += 1;
                }
            }
            let stats = snapshot(&game, year);
            deficits += stats["clubs_below_minimum"].as_u64().unwrap()
                + stats["clubs_missing_positions"].as_u64().unwrap();
            assert_eq!(stats["duplicate_ids"], 0);
            assert_eq!(stats["duplicate_moves"], 0);
            assert_eq!(stats["club_players_without_contract"], 0);
            assert_eq!(stats["clubs_below_minimum"], 0);
            assert_eq!(stats["clubs_missing_positions"], 0);
            assert_eq!(stats["clubs_missing_healthy_positions"], 0);
            if end_of_season::is_season_complete(&game) {
                end_of_season::process_end_of_season(&mut game);
                // Rollover restores the user's scope; this observer has no human club.
                game.active_competition_ids = vec!["validation-scorelines-only".into()];
            }
            game.messages.clear();
            game.news.clear();
            days += 1;
            assert!(
                days < 500,
                "season did not roll over at {}: {:?}",
                game.clock.current_date,
                game.competitions
                    .iter()
                    .map(|c| (
                        &c.name,
                        c.season,
                        c.fixtures
                            .iter()
                            .filter(|f| f.status == domain::league::FixtureStatus::Scheduled)
                            .map(|f| (&f.date, &f.competition))
                            .take(3)
                            .collect::<Vec<_>>()
                    ))
                    .collect::<Vec<_>>()
            );
            if game.primary_competition().unwrap().season != initial_season {
                break;
            }
        }
        if [1, 5, 10, 20].contains(&year) || year == years {
            let stats = snapshot(&game, year);
            // Broad balance guards for this reference world, beyond roster correctness.
            let active = stats["active_players"].as_f64().unwrap();
            assert!(
                active <= initial_population * 1.3,
                "active population inflation"
            );
            assert!(stats["total_players"].as_f64().unwrap() <= initial_population * 1.5);
            assert!((60.0..=82.0).contains(&stats["mean_ovr"].as_f64().unwrap()));
            assert!(stats["mean_potential"].as_f64().unwrap() <= 85.0);
            assert!(stats["players_80_plus"].as_f64().unwrap() / active <= 0.5);
            assert!(stats["players_90_plus"].as_f64().unwrap() / active <= 0.03);
            assert!((20.0..=31.0).contains(&stats["mean_age"].as_f64().unwrap()));
            println!("{}", stats);
        }
    }
    println!(
        "{}",
        serde_json::json!({"elapsed_seconds": started.elapsed().as_secs_f64(), "daily_transfer_max": per_day_max, "daily_deficits": deficits, "wage_policy_violations": bad_transfers, "final_year": game.clock.current_date.year()})
    );
    assert_eq!(deficits, 0);
    assert_eq!(bad_transfers, 0);
}
