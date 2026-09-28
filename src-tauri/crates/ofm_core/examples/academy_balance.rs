//! Deterministic candidate-distribution benchmark. Candidates never join the world.
//! cargo run --manifest-path src-tauri/Cargo.toml -p ofm_core --example academy_balance -- 2000
use chrono::{TimeZone, Utc};
use domain::{manager::Manager, player::Position, team::Team};
use ofm_core::{academy, clock::GameClock, game::Game};

fn main() {
    let seasons: u32 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(2000);
    assert!(seasons > 0);
    for club_rating in [50, 65, 76] {
        for level in 1..=5 {
            let mut team = Team::new(
                "benchmark".into(),
                "Benchmark".into(),
                "BEN".into(),
                "England".into(),
                "City".into(),
                "Ground".into(),
                10000,
            );
            team.facilities.youth = level;
            let manager = Manager::new(
                "user".into(),
                "User".into(),
                "Manager".into(),
                "1980-01-01".into(),
                "England".into(),
            );
            let mut game = Game::new(
                GameClock::new(Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap()),
                manager,
                vec![team.clone()],
                vec![],
                vec![],
                vec![],
            );
            for i in 0..11 {
                let mut p = academy::generate_prospect(
                    &game,
                    &team,
                    &Position::Midfielder,
                    &format!("anchor-{i}"),
                );
                p.ovr = club_rating;
                game.players.push(p);
            }
            let mut total = 0;
            let mut sum_ovr = 0_u64;
            let mut sum_potential = 0_u64;
            let mut selected_potential = 0_u64;
            let mut selected = 0;
            let mut great_years = 0;
            let mut elite_years = 0;
            let mut elite_candidates = 0;
            for season in 0..seasons {
                let mut pool = academy::generate_candidates(&game, &team, season);
                total += pool.len();
                sum_ovr += pool.iter().map(|c| u64::from(c.player.ovr)).sum::<u64>();
                sum_potential += pool
                    .iter()
                    .map(|c| u64::from(c.player.potential))
                    .sum::<u64>();
                let elite = pool.iter().filter(|c| c.player.potential >= 90).count();
                elite_candidates += elite;
                elite_years += usize::from(elite > 0);
                great_years += usize::from(pool.iter().any(|c| c.player.potential >= 85));
                assert!(
                    pool.iter()
                        .all(|c| (35..=72).contains(&c.player.ovr) && c.player.potential <= 95)
                );
                assert!(pool.iter().any(|c| c.player.potential >= 65));
                // The manager ranks the public report and current ability, not hidden potential.
                pool.sort_by_key(|c| {
                    std::cmp::Reverse(
                        u32::from(c.potential_low)
                            + u32::from(c.potential_high)
                            + u32::from(c.player.ovr),
                    )
                });
                for candidate in pool
                    .iter()
                    .take(usize::from(academy::policy(level).signings))
                {
                    selected += 1;
                    selected_potential += u64::from(candidate.player.potential);
                }
            }
            let elite_rate = elite_candidates as f64 / total as f64;
            assert!(elite_rate < 0.02, "elite potential cannot become routine");
            println!(
                "{}",
                serde_json::json!({"club_rating":club_rating,"level":level,"seasons":seasons,"candidates":total,"mean_initial_ovr":sum_ovr as f64/total as f64,"mean_potential":sum_potential as f64/total as f64,"mean_selected_potential":selected_potential as f64/selected as f64,"annual_85_plus_probability":great_years as f64/f64::from(seasons),"annual_90_plus_probability":elite_years as f64/f64::from(seasons),"elite_candidate_rate":elite_rate})
            );
        }
    }
}
