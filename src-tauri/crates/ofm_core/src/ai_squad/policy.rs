use super::*;
use domain::player::{LoanOfferStatus, PlayerMovementKind, TransferOfferStatus};
use domain::team::Team;

#[derive(Default)]
pub(super) struct SquadProfile {
    pub size: usize,
    pub depths: [usize; 4],
    pub healthy: usize,
    pub healthy_depths: [usize; 4],
    pub healthy_keepers: usize,
    pub quality: u8,
    pub position_quality: [u8; 4],
}

pub(super) fn profile(game: &Game, roster: &[usize]) -> SquadProfile {
    let mut result = SquadProfile::default();
    let mut qualities = Vec::new();
    let mut position_totals = [0_u32; 4];
    for &index in roster {
        let p = &game.players[index];
        if p.retired {
            continue;
        }
        result.size += 1;
        result.depths[group(p)] += 1;
        position_totals[group(p)] += u32::from(p.ovr);
        if p.injury.is_none() {
            result.healthy += 1;
            result.healthy_depths[group(p)] += 1;
            result.healthy_keepers += usize::from(group(p) == 0);
        }
        qualities.push(p.ovr);
    }
    for (g, total) in position_totals.into_iter().enumerate() {
        result.position_quality[g] = if result.depths[g] == 0 {
            50
        } else {
            (total / result.depths[g] as u32) as u8
        };
    }
    qualities.sort_unstable();
    result.quality = qualities.get(qualities.len() / 2).copied().unwrap_or(50);
    result
}

pub(super) fn priority_position(profile: &SquadProfile, target: bool) -> Option<usize> {
    if let Some(g) = (0..4)
        .filter(|&g| profile.healthy_depths[g] < MIN_HEALTHY_POSITION_DEPTH[g])
        .max_by_key(|&g| {
            (MIN_HEALTHY_POSITION_DEPTH[g] - profile.healthy_depths[g]) * 100
                / MIN_HEALTHY_POSITION_DEPTH[g]
        })
    {
        return Some(g);
    }
    let depths = if target {
        TARGET_POSITION_DEPTH
    } else {
        MIN_POSITION_DEPTH
    };
    let group = (0..4)
        .filter(|&g| profile.depths[g] < depths[g])
        .max_by_key(|&g| (depths[g] - profile.depths[g]) * 100 / depths[g]);
    group.or_else(|| {
        (profile.size
            < if target {
                TARGET_SQUAD_SIZE
            } else {
                MIN_SQUAD_SIZE
            }
            || profile.healthy < 11)
            .then(|| (1..4).min_by_key(|&g| profile.depths[g]).unwrap())
    })
}

pub(super) fn reserved(p: &Player) -> bool {
    p.active_loan.is_some()
        || p.transfer_offers
            .iter()
            .any(|o| o.status == TransferOfferStatus::PendingRegistration)
        || p.loan_offers
            .iter()
            .any(|o| o.status == LoanOfferStatus::PendingRegistration)
}

pub(super) fn recently_joined(p: &Player, date: NaiveDate) -> bool {
    p.movement_history
        .iter()
        .rev()
        .find(|entry| {
            matches!(
                entry.kind,
                PlayerMovementKind::PermanentTransfer
                    | PlayerMovementKind::FreeAgentSigning
                    | PlayerMovementKind::LoanToBuy
            )
        })
        .and_then(|entry| NaiveDate::parse_from_str(&entry.date, "%Y-%m-%d").ok())
        .is_some_and(|joined| (date - joined).num_days() < 180)
}

pub(super) fn contract_end(p: &Player) -> Option<NaiveDate> {
    p.contract_end
        .as_deref()
        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
}

pub(super) fn retention_score(p: &Player, date: NaiveDate) -> i32 {
    i32::from(p.ovr) * 4 + i32::from(p.potential.saturating_sub(p.ovr))
        - (age(p, date) - 29).max(0) * 3
}

pub(super) fn affordable_wage(game: &Game, team: &Team, old_wage: u32, wage: u32) -> bool {
    let bill = crate::finances::calc_annual_wages(game, &team.id);
    wage_projection_allows(team, bill, old_wage, wage)
}

pub(super) fn wage_projection_allows(team: &Team, bill: i64, old_wage: u32, wage: u32) -> bool {
    let projected = bill - i64::from(old_wage) + i64::from(wage);
    // No additional wage commitments above the envelope. Legacy over-budget
    // clubs may keep a needed player at unchanged/lower pay, never increase it.
    projected <= team.wage_budget.max(0) || (old_wage > 0 && projected <= bill)
}

pub(super) fn can_sell(game: &Game, roster: &[usize], p: &Player) -> bool {
    let squad = profile(game, roster);
    let position = group(p);
    !reserved(p)
        && !recently_joined(p, game.clock.current_date.date_naive())
        && squad.size > MIN_SQUAD_SIZE
        && squad.depths[position] > MIN_POSITION_DEPTH[position]
        && (p.injury.is_some()
            || (squad.healthy > 11
                && squad.healthy_depths[position] > MIN_HEALTHY_POSITION_DEPTH[position]))
        && (position != 0 || p.injury.is_some() || squad.healthy_keepers > 1)
}

/// International call-ups may protect a small free-agent reserve, but cannot
/// turn every released player into a permanent national-team-only player.
pub(crate) fn national_reserves(game: &Game) -> std::collections::HashSet<String> {
    let called_up: std::collections::HashSet<_> = game
        .national_teams
        .iter()
        .flat_map(|t| t.squad_player_ids.iter())
        .collect();
    let mut players: Vec<_> = game
        .players
        .iter()
        .filter(|p| !p.retired && p.team_id.is_none() && called_up.contains(&p.id))
        .collect();
    players.sort_by_key(|p| (std::cmp::Reverse(p.ovr), p.id.clone()));
    players
        .into_iter()
        .take(game.teams.len() * 2)
        .map(|p| p.id.clone())
        .collect()
}
