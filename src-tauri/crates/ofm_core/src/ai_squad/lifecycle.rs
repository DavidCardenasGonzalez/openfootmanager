use super::*;
use chrono::Months;
use domain::player::{PlayerMovementEntry, PlayerMovementKind, SquadRole};
use domain::team::Team;

pub(super) fn review_club(game: &mut Game, id: &str, roster: &[usize]) {
    let date = game.clock.current_date.date_naive();
    let Some(team) = game.teams.iter().find(|t| t.id == id).cloned() else {
        return;
    };
    let squad = profile(game, roster);
    let mut ranked = roster.to_vec();
    ranked.sort_by_key(|&i| std::cmp::Reverse(retention_score(&game.players[i], date)));
    let mut kept = [0_usize; 4];
    let mut wage_bill = crate::finances::calc_annual_wages(game, id);
    for (rank, index) in ranked.into_iter().enumerate() {
        let player = &game.players[index];
        if reserved(player) {
            continue;
        }
        let position = group(player);
        let essential = kept[position] < MIN_POSITION_DEPTH[position];
        let wanted = essential
            || (rank < TARGET_SQUAD_SIZE && kept[position] < TARGET_POSITION_DEPTH[position]);
        if wanted {
            kept[position] += 1;
        }
        let listed = !wanted && can_sell(game, roster, player);
        let years = if age(player, date) >= 32 {
            1
        } else if age(player, date) <= 23 {
            4
        } else {
            3
        };
        let renew = wanted && contract_end(player).is_none_or(|end| (end - date).num_days() <= 180);
        let wage = crate::contracts::expected_wage(player, &team, date);
        let allowed = wage_projection_allows(&team, wage_bill, player.wage, wage);
        let promote = player.squad_role == SquadRole::Youth
            && (age(player, date) >= 21
                || (age(player, date) >= 18 && player.ovr + 5 >= squad.quality));
        let player = &mut game.players[index];
        if !recently_joined(player, date) {
            player.transfer_listed = listed;
        }
        if promote {
            player.squad_role = SquadRole::Senior;
            game.squad_management.totals.promotions += 1;
        }
        if renew && allowed {
            wage_bill += i64::from(wage) - i64::from(player.wage);
            player.contract_end = date
                .checked_add_months(Months::new(years * 12))
                .map(|end| end.to_string());
            player.wage = wage;
            player.morale_core.renewal_state = None;
            game.squad_management.totals.renewals += 1;
        }
    }
}

pub(super) fn fill_vacancies(game: &mut Game, id: &str, mut roster: Vec<usize>) {
    let date = game.clock.current_date.date_naive();
    let Some(team) = game.teams.iter().find(|t| t.id == id).cloned() else {
        return;
    };
    loop {
        let squad = profile(game, &roster);
        let Some(position) = priority_position(&squad, false) else {
            break;
        };
        // Imported/loan-return squads can already exceed the recruitment cap.
        // Repair missing coverage without tearing up existing contracts: these
        // clubs list surplus players and let unwanted deals expire naturally.
        if roster.len() >= MAX_SQUAD_SIZE
            && squad
                .depths
                .iter()
                .zip(MIN_POSITION_DEPTH)
                .all(|(&depth, min)| depth >= min)
            && squad.healthy >= 11
            && squad
                .healthy_depths
                .iter()
                .zip(MIN_HEALTHY_POSITION_DEPTH)
                .all(|(&depth, min)| depth >= min)
        {
            break;
        }
        let candidate = game
            .players
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                !p.retired
                    && p.team_id.is_none()
                    && !reserved(p)
                    && p.injury.is_none()
                    && group(p) == position
            })
            .filter(|(_, p)| {
                age(p, date) < 34 && p.ovr >= squad.position_quality[position].saturating_sub(15)
            })
            .filter(|(_, p)| {
                affordable_wage(
                    game,
                    &team,
                    0,
                    crate::contracts::expected_wage(p, &team, date),
                )
            })
            .max_by_key(|(_, p)| retention_score(p, date))
            .map(|(i, _)| i);
        if let Some(index) = candidate {
            let wage = crate::contracts::expected_wage(&game.players[index], &team, date);
            let jersey = crate::roster::resolve_jersey_for(game, &game.players[index], &team);
            let player = &mut game.players[index];
            player.team_id = Some(id.into());
            player.wage = wage;
            player.jersey_number = jersey;
            player.contract_end = date
                .checked_add_months(Months::new(36))
                .map(|end| end.to_string());
            player.squad_role = SquadRole::Senior;
            player.transfer_listed = false;
            player.loan_listed = false;
            player.transfer_offers.clear();
            player.loan_offers.clear();
            player.morale_core.renewal_state = None;
            player.movement_history.push(PlayerMovementEntry {
                date: date.to_string(),
                kind: PlayerMovementKind::FreeAgentSigning,
                from_team_id: None,
                from_team_name: None,
                to_team_id: Some(id.into()),
                to_team_name: Some(team.name.clone()),
                fee: None,
                loan_end_date: None,
            });
            game.squad_management.inactive_since.remove(&player.id);
            game.squad_management.totals.free_agent_signings += 1;
            roster.push(index);
        } else {
            let mut serial = game.squad_management.totals.emergency_recruits;
            let prospect_id = loop {
                let candidate = format!("emergency-{id}-{date}-{serial}");
                if !game.players.iter().any(|p| p.id == candidate) {
                    break candidate;
                }
                serial += 1;
            };
            let player = new_prospect(game, &team, position, &prospect_id);
            roster.push(game.players.len());
            game.players.push(player);
            game.squad_management.totals.emergency_recruits += 1;
        }
    }
}

pub(super) fn annual_intake(game: &mut Game) {
    let date = game.clock.current_date.date_naive();
    let start = game.clock.start_date.date_naive();
    let calendar_cycle = (date.year()
        - start.year()
        - i32::from((date.month(), date.day()) < (start.month(), start.day())))
    .max(0) as u32;
    let season_cycle = game
        .primary_competition()
        .zip(game.squad_management.opening_season)
        .map(|(c, initial)| c.season.saturating_sub(initial))
        .unwrap_or(0);
    let cycle = calendar_cycle.max(season_cycle);
    if cycle <= game.squad_management.last_intake_cycle {
        return;
    }
    let mut active = game
        .players
        .iter()
        .filter(|p| !p.retired)
        .count()
        .saturating_sub(national_reserves(game).len());
    let cap = game.teams.len() * (MAX_SQUAD_SIZE + 1);
    // Also check the players themselves, so legacy saves missing the ledger
    // cannot repeat an intake that already exists in their population.
    let mut existing_ids: std::collections::HashSet<_> =
        game.players.iter().map(|p| p.id.clone()).collect();
    let mut rosters = roster_indices(game);
    // The human club chooses from a separate finite candidate pool.
    let mut teams = game.teams.clone();
    teams.sort_by_key(|t| t.id.clone());
    if !teams.is_empty() {
        let offset = cycle as usize % teams.len();
        teams.rotate_left(offset);
    }
    for team in teams {
        if game.manager.team_id.as_deref() == Some(&team.id) {
            continue;
        }
        let roster = rosters.entry(team.id.clone()).or_default();
        for slot in 0..2 {
            if active >= cap || roster.len() >= MAX_SQUAD_SIZE {
                break;
            }
            let prospect_id = format!("academy-{}-{cycle}-{slot}", team.id);
            if !existing_ids.insert(prospect_id.clone()) {
                continue;
            }
            let squad = profile(game, roster);
            let position = priority_position(&squad, true).unwrap_or_else(|| {
                // Replace the oldest positional cohort rather than always drawing forwards.
                (0..4)
                    .max_by_key(|&g| {
                        roster
                            .iter()
                            .filter(|&&i| group(&game.players[i]) == g)
                            .map(|&i| age(&game.players[i], date))
                            .sum::<i32>()
                            / squad.depths[g].max(1) as i32
                    })
                    .unwrap()
            });
            let player = new_prospect(game, &team, position, &prospect_id);
            roster.push(game.players.len());
            game.players.push(player);
            active += 1;
            game.squad_management.totals.youth_intake += 1;
        }
    }
    game.squad_management.last_intake_cycle = cycle;
}

pub(super) fn new_prospect(game: &Game, team: &Team, position: usize, id: &str) -> Player {
    crate::academy::generate_prospect(game, team, &group_position(position), id)
}

pub(super) fn process_inactive_players(game: &mut Game) {
    let date = game.clock.current_date.date_naive();
    let mut remove = std::collections::HashSet::new();
    let national_reserves = national_reserves(game);
    // Keep a bounded set of full career profiles for the Hall of Fame, in
    // addition to the two-year retirement archive. Award summaries live on
    // independently even when other retired player profiles are pruned.
    let mut legends: Vec<_> = game
        .players
        .iter()
        .filter(|p| p.retired && p.career.iter().any(|c| c.appearances > 0))
        .map(|p| {
            let score = p
                .career
                .iter()
                .map(|c| {
                    u64::from(c.appearances) + 3 * u64::from(c.goals) + 2 * u64::from(c.assists)
                })
                .sum::<u64>();
            (score, p.id.clone())
        })
        .collect();
    legends.sort_unstable_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let legends: std::collections::HashSet<_> =
        legends.into_iter().take(48).map(|(_, id)| id).collect();
    for p in &mut game.players {
        if p.team_id.is_some() && !p.retired {
            game.squad_management.inactive_since.remove(&p.id);
            continue;
        }
        let since = game
            .squad_management
            .inactive_since
            .entry(p.id.clone())
            .or_insert_with(|| {
                p.movement_history
                    .last()
                    .filter(|e| e.kind == PlayerMovementKind::Released)
                    .map(|e| e.date.clone())
                    .unwrap_or_else(|| game.clock.start_date.date_naive().to_string())
            });
        let elapsed = NaiveDate::parse_from_str(since, "%Y-%m-%d")
            .map(|d| (date - d).num_days())
            .unwrap_or(0);
        if p.retired {
            if elapsed > 730 && !legends.contains(&p.id) {
                remove.insert(p.id.clone());
            }
        } else if !national_reserves.contains(&p.id)
            && elapsed > if age(p, date) <= 21 { 730 } else { 365 }
        {
            p.retired = true;
            p.wage = 0;
            p.contract_end = None;
            p.transfer_offers.clear();
            p.loan_offers.clear();
            *since = date.to_string();
            game.squad_management.totals.departures += 1;
        }
    }
    game.players.retain(|p| !remove.contains(&p.id));
    for id in &remove {
        game.squad_management.inactive_since.remove(id);
    }
    for team in &mut game.national_teams {
        team.squad_player_ids.retain(|id| !remove.contains(id));
    }
    game.squad_management.totals.archived_players += remove.len() as u64;
}
