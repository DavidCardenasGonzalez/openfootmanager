//! Keeping the unattached-player market playable.
//!
//! National-team backfill and squad repairs create unattached players, but the
//! result can be lopsided: a tight free-agent cap used to stop generation
//! before any forward existed, and a run of defender-heavy squads leaves clubs
//! with nobody to sign up front. This pass tops up any under-represented
//! position group so every transfer window has credible cover everywhere.

use crate::game::Game;
use domain::player::Position;

/// Free agents kept per position group for a club world of `clubs` clubs.
///
/// Two free agents per club split evenly across the four groups: enough cover
/// for injuries and windows without turning the market into a second league.
/// Worlds smaller than a four-club mini-league are left alone — a one-club
/// test or career has no meaningful transfer market to supply.
pub fn free_agent_target_per_group(clubs: usize) -> usize {
    if clubs < 4 { 0 } else { clubs / 2 }
}

/// Fill any under-represented position group in the unattached pool.
///
/// Returns the number of players created. The pass is idempotent: once each
/// group reaches the target it does nothing. Created players are ordinary
/// national-pool free agents, so any club can sign them and they retire
/// naturally if nobody does.
pub fn ensure_balanced_free_agent_market(game: &mut Game) -> usize {
    let target = free_agent_target_per_group(game.teams.len());
    if target == 0 {
        return 0;
    }

    let mut counts = [0usize; 4];
    for player in game
        .players
        .iter()
        .filter(|player| !player.retired && player.team_id.is_none())
    {
        counts[position_group_index(&player.natural_position)] += 1;
    }

    let current_year = game
        .clock
        .current_date
        .format("%Y")
        .to_string()
        .parse::<u32>()
        .unwrap_or(2026);
    let codes: Vec<&'static str> = crate::nations::NATION_CATALOG
        .iter()
        .map(|nation| nation.code)
        .collect();
    let today = game.clock.current_date.date_naive().to_string();
    let mut created = 0;

    for group in 0..4 {
        let mut serial = 0;
        while counts[group] < target {
            let code = codes[(counts[group] + serial) % codes.len()];
            let player = crate::generator::generate_national_team_player(
                code,
                group_slot(group, serial),
                current_year,
            );
            game.squad_management
                .inactive_since
                .insert(player.id.clone(), today.clone());
            game.players.push(player);
            game.squad_management.totals.free_agent_recruits += 1;
            counts[group] += 1;
            created += 1;
            serial += 1;
        }
    }

    created
}

fn position_group_index(position: &Position) -> usize {
    match position.to_group_position() {
        Position::Goalkeeper => 0,
        Position::Defender => 1,
        Position::Midfielder => 2,
        _ => 3,
    }
}

/// A representative slot inside each group's range. Avoid the youth-reserved
/// slots so the generated player draws a senior age.
fn group_slot(group: usize, serial: usize) -> usize {
    match group {
        0 => 0,
        1 => 2 + serial % 6,
        2 => 9 + serial % 6,
        _ => 16 + serial % 5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::team::Team;

    fn game_with_clubs(clubs: usize) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr".to_string(),
            "Alex".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let teams = (0..clubs)
            .map(|index| {
                Team::new(
                    format!("club-{index}"),
                    format!("Club {index}"),
                    format!("C{index:02}"),
                    "England".to_string(),
                    "City".to_string(),
                    "Ground".to_string(),
                    1_000,
                )
            })
            .collect();
        Game::new(clock, manager, teams, vec![], vec![], vec![])
    }

    fn pushed_free_agent(game: &mut Game, slot: usize, id: &str) {
        let mut player = crate::generator::generate_national_team_player("AR", slot, 2026);
        player.id = id.to_string();
        game.squad_management
            .inactive_since
            .insert(player.id.clone(), "2026-06-01".to_string());
        game.players.push(player);
    }

    fn free_agent_counts(game: &Game) -> [usize; 4] {
        let mut counts = [0usize; 4];
        for player in game
            .players
            .iter()
            .filter(|player| !player.retired && player.team_id.is_none())
        {
            counts[position_group_index(&player.natural_position)] += 1;
        }
        counts
    }

    #[test]
    fn balancing_fills_every_missing_position_group() {
        let mut game = game_with_clubs(8);
        for index in 0..4 {
            pushed_free_agent(&mut game, 2, &format!("def-{index}"));
        }

        let created = ensure_balanced_free_agent_market(&mut game);

        assert_eq!(created, 12, "four goalkeepers, midfielders and forwards");
        assert_eq!(
            free_agent_counts(&game),
            [4, 4, 4, 4],
            "each group reaches the two-per-club target"
        );
        assert_eq!(game.squad_management.totals.free_agent_recruits, 12);
        assert!(
            game.players
                .iter()
                .filter(|player| player.team_id.is_none())
                .all(|player| !player.retired
                    && player.contract_end.is_none()
                    && game
                        .squad_management
                        .inactive_since
                        .contains_key(&player.id)),
            "every created player is an unattached senior free agent"
        );
    }

    #[test]
    fn balancing_is_idempotent() {
        let mut game = game_with_clubs(8);
        for index in 0..4 {
            pushed_free_agent(&mut game, 2, &format!("def-{index}"));
        }

        assert_eq!(ensure_balanced_free_agent_market(&mut game), 12);
        assert_eq!(
            ensure_balanced_free_agent_market(&mut game),
            0,
            "a balanced market must not keep generating players"
        );
    }

    #[test]
    fn a_tiny_world_has_no_market_to_fill() {
        assert_eq!(free_agent_target_per_group(0), 0);
        assert_eq!(free_agent_target_per_group(1), 0);
        assert_eq!(free_agent_target_per_group(3), 0);
        assert_eq!(free_agent_target_per_group(4), 2);
        assert_eq!(free_agent_target_per_group(8), 4);
    }

    #[test]
    fn balancing_does_nothing_without_a_club_world() {
        let mut game = game_with_clubs(0);
        assert_eq!(ensure_balanced_free_agent_market(&mut game), 0);
        assert!(game.players.is_empty());
    }
}
