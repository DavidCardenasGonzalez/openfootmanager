use super::*;
use chrono::{Duration, Months};
use domain::player::PlayerMovementKind;

pub(super) fn shop(game: &mut Game) {
    use domain::season::TransferWindowStatus;
    if !matches!(
        game.season_context.transfer_window.status,
        TransferWindowStatus::Open | TransferWindowStatus::DeadlineDay
    ) {
        return;
    }
    let date = game.clock.current_date.date_naive();
    if game.squad_management.last_market_date.as_deref() == Some(&date.to_string()) {
        return;
    }
    game.squad_management.last_market_date = Some(date.to_string());
    let mut rosters = roster_indices(game);
    let ids = ai_club_ids(game);
    let limit = daily_transfer_limit(ids.len());
    let mut wage_bills: HashMap<_, _> = game
        .teams
        .iter()
        .map(|t| {
            (
                t.id.clone(),
                crate::finances::calc_annual_wages(game, &t.id),
            )
        })
        .collect();
    let mut moved = 0;
    let mut moved_ids = std::collections::HashSet::new();
    // One short, shared list; seller depth is rechecked after every completed sale.
    let candidates: Vec<usize> = game
        .players
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            !p.retired
                && p.team_id.is_some()
                && p.team_id != game.manager.team_id
                && !reserved(p)
                && (p.transfer_listed || crate::transfers::incoming_interest_score(date, p) > 60)
        })
        .map(|(index, _)| index)
        .collect();
    for buyer_id in ids {
        if moved >= limit {
            break;
        }
        let roster = rosters.get(&buyer_id).cloned().unwrap_or_default();
        let squad = profile(game, &roster);
        if squad.size >= MAX_SQUAD_SIZE {
            continue;
        }
        // At most two paid arrivals in a week and six in the present window year.
        // Histories survive reloads; daily rotation distributes the global allowance.
        let arrivals = |since: NaiveDate| {
            game.players
                .iter()
                .flat_map(|p| &p.movement_history)
                .filter(|e| {
                    e.to_team_id.as_deref() == Some(&buyer_id)
                        && e.kind == PlayerMovementKind::PermanentTransfer
                })
                .filter(|e| {
                    NaiveDate::parse_from_str(&e.date, "%Y-%m-%d").is_ok_and(|d| d >= since)
                })
                .count()
        };
        if arrivals(date - Duration::days(7)) >= 2 || arrivals(date - Duration::days(365)) >= 6 {
            continue;
        }
        let Some(team) = game.teams.iter().find(|t| t.id == buyer_id).cloned() else {
            continue;
        };
        let wage_bill = wage_bills.get(&buyer_id).copied().unwrap_or(0);
        let desired = priority_position(&squad, true);
        let candidate = candidates
            .iter()
            .copied()
            .filter(|&index| {
                let p = &game.players[index];
                let Some(owner) = p.team_id.as_deref() else {
                    return false;
                };
                if owner == buyer_id
                    || moved_ids.contains(&p.id)
                    || p.injury.is_some()
                    || age(p, date) >= 33
                {
                    return false;
                }
                if !can_sell(
                    game,
                    rosters.get(owner).map(Vec::as_slice).unwrap_or(&[]),
                    p,
                ) {
                    return false;
                }
                let position = group(p);
                let improves = p.ovr >= squad.position_quality[position].saturating_add(5)
                    && squad.depths[position] <= TARGET_POSITION_DEPTH[position];
                if !(desired == Some(position) || improves)
                    || p.ovr + 10 < squad.position_quality[position]
                {
                    return false;
                }
                let fee = crate::transfers::suggested_incoming_fee(date, p);
                // Reserve half the envelope for other needs, and six months of payroll.
                fee <= team.transfer_budget.max(0) as u64 / 2
                    && fee <= (team.finance - wage_bill / 2).max(0) as u64
                    && wage_projection_allows(&team, wage_bill, 0, p.wage)
            })
            .max_by_key(|&index| {
                let p = &game.players[index];
                let need = i32::from(desired == Some(group(p))) * 200;
                need + retention_score(p, date)
                    - (crate::transfers::suggested_incoming_fee(date, p) / 500_000) as i32
            });
        let Some(index) = candidate else {
            continue;
        };
        let p = &game.players[index];
        let player_id = p.id.clone();
        let owner = p.team_id.clone().unwrap();
        let fee = crate::transfers::suggested_incoming_fee(date, p);
        if crate::transfers::execute_transfer(game, &player_id, &buyer_id, &owner, fee).is_ok() {
            // A transfer includes a new employment contract, rather than inheriting
            // a deal that may expire days after registration.
            let p = &mut game.players[index];
            let years = if age(p, date) >= 30 { 2 } else { 3 };
            for offer in &mut p.transfer_offers {
                if offer.status == domain::player::TransferOfferStatus::Pending {
                    offer.status = domain::player::TransferOfferStatus::Withdrawn;
                    offer.closed_on = Some(date.to_string());
                }
            }
            for offer in &mut p.loan_offers {
                if offer.status == domain::player::LoanOfferStatus::Pending {
                    offer.status = domain::player::LoanOfferStatus::Withdrawn;
                    offer.closed_on = Some(date.to_string());
                }
            }
            p.contract_end = date
                .checked_add_months(Months::new(years * 12))
                .map(|end| end.to_string());
            *wage_bills.entry(buyer_id.clone()).or_default() += i64::from(p.wage);
            *wage_bills.entry(owner.clone()).or_default() -= i64::from(p.wage);
            rosters.entry(owner).or_default().retain(|&i| i != index);
            rosters.entry(buyer_id).or_default().push(index);
            moved_ids.insert(player_id);
            moved += 1;
            game.squad_management.totals.transfers += 1;
        }
    }
}
