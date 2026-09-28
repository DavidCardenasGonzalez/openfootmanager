//! Finite candidate pools create choices without adding uncontracted players to the world.
use crate::game::Game;
use chrono::{Datelike, Duration, Months, NaiveDate};
use domain::player::{Player, SquadRole};
use serde::{Deserialize, Serialize};

mod generation;
pub use generation::{club_level, generate_candidates, generate_prospect, level, policy};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcademyIntake {
    #[serde(default)]
    pub cycle: u32,
    #[serde(default)]
    pub level: u8,
    #[serde(default)]
    pub expires_on: String,
    #[serde(default)]
    pub signed: u8,
    #[serde(default)]
    pub scout_candidates: u8,
    #[serde(default)]
    pub candidates: Vec<AcademyCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcademyCandidate {
    #[serde(default = "generation::empty_player")]
    pub player: Player,
    #[serde(default)]
    pub potential_low: u8,
    #[serde(default)]
    pub potential_high: u8,
    #[serde(default)]
    pub signing_fee: i64,
    #[serde(default)]
    pub annual_wage: u32,
}

pub fn current_cycle(game: &Game) -> u32 {
    let start = game.clock.start_date.date_naive();
    let date = game.clock.current_date.date_naive();
    let calendar = (date.year()
        - start.year()
        - i32::from((date.month(), date.day()) < (start.month(), start.day())))
    .max(0) as u32;
    let season = game
        .primary_competition()
        .zip(game.squad_management.opening_season)
        .map(|(c, initial)| c.season.saturating_sub(initial))
        .unwrap_or(0);
    calendar.max(season)
}

pub fn process_human_intake(game: &mut Game) {
    let today = game.clock.current_date.date_naive();
    // Inactive clubs' expired candidates are removed too. Only their small quota ledger remains.
    for intake in game.squad_management.academies.values_mut() {
        if NaiveDate::parse_from_str(&intake.expires_on, "%Y-%m-%d").is_ok_and(|end| today > end) {
            intake.candidates.clear();
        }
    }
    let Some(id) = game.manager.team_id.clone() else {
        return;
    };
    let Some(team) = game.teams.iter().find(|t| t.id == id) else {
        return;
    };
    let cycle = current_cycle(game);
    if game
        .squad_management
        .academies
        .get(&id)
        .is_some_and(|pool| pool.cycle >= cycle)
    {
        return;
    }
    let candidates = generate_candidates(game, team, cycle);
    let intake = AcademyIntake {
        cycle,
        level: level(team),
        expires_on: (today + Duration::days(180)).to_string(),
        candidates,
        ..Default::default()
    };
    let count = intake.candidates.len().to_string();
    let signings = policy(intake.level).signings.to_string();
    let mut message = domain::message::InboxMessage::new(
        format!("academy-intake-{id}-{cycle}"),
        String::new(),
        String::new(),
        String::new(),
        today.to_string(),
    )
    .with_category(domain::message::MessageCategory::ScoutReport)
    .with_i18n(
        "academy.title",
        "academy.messageBody",
        std::collections::HashMap::from([("count".into(), count), ("signings".into(), signings)]),
    )
    .with_action(domain::message::MessageAction {
        id: "review-academy".into(),
        label: String::new(),
        label_key: Some("youthAcademy.title".into()),
        action_type: domain::message::ActionType::NavigateTo {
            route: "/dashboard?tab=Youth".into(),
        },
        resolved: false,
    });
    message.sender_key = Some("youthAcademy.title".into());
    game.messages.push(message);
    game.squad_management.academies.insert(id, intake);
}

fn validate_player(game: &Game, candidate: &AcademyCandidate) -> Result<String, String> {
    let id = game
        .manager
        .team_id
        .as_deref()
        .ok_or("be.error.noTeamAssigned")?;
    let team = game
        .teams
        .iter()
        .find(|t| t.id == id)
        .ok_or("be.error.managedTeamNotFound")?;
    let pool = game
        .squad_management
        .academies
        .get(id)
        .ok_or("academy.expiredError")?;
    if pool.cycle != current_cycle(game)
        || NaiveDate::parse_from_str(&pool.expires_on, "%Y-%m-%d")
            .map_or(true, |end| game.clock.current_date.date_naive() > end)
    {
        return Err("academy.expiredError".into());
    }
    if pool.signed >= policy(pool.level).signings {
        return Err("academy.quotaError".into());
    }
    if game
        .players
        .iter()
        .filter(|p| !p.retired && p.team_id.as_deref() == Some(id))
        .count()
        >= crate::ai_squad::MAX_SQUAD_SIZE
    {
        return Err("academy.rosterError".into());
    }
    if game.players.iter().any(|p| p.id == candidate.player.id) {
        return Err("academy.candidateError".into());
    }
    if team.finance < candidate.signing_fee {
        return Err("academy.cashError".into());
    }
    if crate::finances::calc_annual_wages(game, id) + i64::from(candidate.annual_wage)
        > team.wage_budget
    {
        return Err("academy.wageError".into());
    }
    Ok(id.into())
}

pub fn sign_candidate(game: &mut Game, candidate_id: &str) -> Result<(), String> {
    let id = game
        .manager
        .team_id
        .as_deref()
        .ok_or("be.error.noTeamAssigned")?;
    let candidate = game
        .squad_management
        .academies
        .get(id)
        .and_then(|p| p.candidates.iter().find(|c| c.player.id == candidate_id))
        .cloned()
        .ok_or("academy.candidateError")?;
    enroll(game, candidate)
}

fn enroll(game: &mut Game, candidate: AcademyCandidate) -> Result<(), String> {
    let id = validate_player(game, &candidate)?;
    let date = game.clock.current_date.date_naive();
    // Cash is posted by the existing journal before changing the live roster.
    crate::finances::post(
        game,
        &id,
        -candidate.signing_fee,
        crate::finances::CashKind::Other,
        date,
    )?;
    let team = game
        .teams
        .iter()
        .find(|t| t.id == id)
        .expect("validated team");
    let mut player = candidate.player;
    player.jersey_number = crate::roster::resolve_jersey_for(game, &player, team);
    player.team_id = Some(id.clone());
    player.squad_role = SquadRole::Youth;
    player.wage = candidate.annual_wage;
    player.contract_end = date
        .checked_add_months(Months::new(36))
        .map(|d| d.to_string());
    player
        .movement_history
        .push(domain::player::PlayerMovementEntry {
            date: date.to_string(),
            kind: domain::player::PlayerMovementKind::FreeAgentSigning,
            from_team_id: None,
            from_team_name: None,
            to_team_id: Some(id.clone()),
            to_team_name: Some(team.name.clone()),
            fee: None,
            loan_end_date: None,
        });
    let intake = game
        .squad_management
        .academies
        .get_mut(&id)
        .expect("validated intake");
    intake.signed += 1;
    intake.candidates.retain(|c| c.player.id != player.id);
    game.squad_management.totals.youth_intake += 1;
    game.players.push(player);
    Ok(())
}

pub fn sign_report_candidate(game: &mut Game, player: &Player) -> Result<(), String> {
    process_human_intake(game);
    let id = game
        .manager
        .team_id
        .as_deref()
        .ok_or("be.error.noTeamAssigned")?;
    let pool = game
        .squad_management
        .academies
        .get(id)
        .ok_or("academy.expiredError")?;
    let candidate = pool
        .candidates
        .iter()
        .find(|c| c.player.id == player.id)
        .cloned();
    if candidate.is_none()
        && (player.id.starts_with("academy-candidate-") || player.id.starts_with("academy-scout-"))
    {
        return Err("academy.candidateError".into());
    }
    // Old, already-issued reports remain usable but share the current quota/cost rules.
    let candidate = candidate.unwrap_or_else(|| generation::candidate(player.clone(), pool.level));
    enroll(game, candidate)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcademyCandidateView {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub full_name: String,
    #[serde(default)]
    pub date_of_birth: String,
    #[serde(default)]
    pub nationality: String,
    #[serde(default)]
    pub position: String,
    #[serde(default)]
    pub ovr: u8,
    #[serde(default)]
    pub potential_low: u8,
    #[serde(default)]
    pub potential_high: u8,
    #[serde(default)]
    pub signing_fee: i64,
    #[serde(default)]
    pub annual_wage: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcademyView {
    #[serde(default)]
    pub level: u8,
    #[serde(default)]
    pub cycle: u32,
    #[serde(default)]
    pub expires_on: String,
    #[serde(default)]
    pub signing_limit: u8,
    #[serde(default)]
    pub signings_remaining: u8,
    #[serde(default)]
    pub roster_size: usize,
    #[serde(default)]
    pub roster_limit: usize,
    #[serde(default)]
    pub next_candidates: usize,
    #[serde(default)]
    pub next_signings: u8,
    #[serde(default)]
    pub upgrade_cost: i64,
    #[serde(default)]
    pub upgrade_available: bool,
    #[serde(default)]
    pub candidates: Vec<AcademyCandidateView>,
}

pub fn view(game: &Game) -> Option<AcademyView> {
    let id = game.manager.team_id.as_deref()?;
    let team = game.teams.iter().find(|t| t.id == id)?;
    let pool = game.squad_management.academies.get(id)?;
    Some(AcademyView {
        level: level(team),
        cycle: pool.cycle,
        expires_on: pool.expires_on.clone(),
        signing_limit: policy(pool.level).signings,
        signings_remaining: policy(pool.level).signings.saturating_sub(pool.signed),
        roster_size: game
            .players
            .iter()
            .filter(|p| !p.retired && p.team_id.as_deref() == Some(id))
            .count(),
        roster_limit: crate::ai_squad::MAX_SQUAD_SIZE,
        next_candidates: policy(level(team)).candidates,
        next_signings: policy(level(team)).signings,
        upgrade_cost: crate::club::next_upgrade_cost(team, &domain::team::FacilityType::Youth),
        upgrade_available: level(team) < 5
            && game.squad_management.academy_upgrades.get(id) != Some(&current_cycle(game)),
        candidates: pool
            .candidates
            .iter()
            .map(|c| AcademyCandidateView {
                id: c.player.id.clone(),
                full_name: c.player.full_name.clone(),
                date_of_birth: c.player.date_of_birth.clone(),
                nationality: c.player.nationality.clone(),
                position: format!("{:?}", c.player.natural_position),
                ovr: c.player.ovr,
                potential_low: c.potential_low,
                potential_high: c.potential_high,
                signing_fee: c.signing_fee,
                annual_wage: c.annual_wage,
            })
            .collect(),
    })
}

pub fn reject_candidate(game: &mut Game, candidate_id: &str) -> Result<(), String> {
    let id = game
        .manager
        .team_id
        .as_deref()
        .ok_or("be.error.noTeamAssigned")?;
    let pool = game
        .squad_management
        .academies
        .get_mut(id)
        .ok_or("academy.candidateError")?;
    let len = pool.candidates.len();
    pool.candidates.retain(|c| c.player.id != candidate_id);
    if len == pool.candidates.len() {
        return Err("academy.candidateError".into());
    }
    Ok(())
}

/// Youth searches share one finite seasonal supply and the same signing budget.
pub fn scout_candidates(
    game: &mut Game,
    target: Option<&domain::player::Position>,
    nationality: Option<&str>,
) -> Vec<Player> {
    process_human_intake(game);
    let Some(id) = game.manager.team_id.clone() else {
        return vec![];
    };
    let Some(team) = game.teams.iter().find(|t| t.id == id).cloned() else {
        return vec![];
    };
    let Some(pool) = game.squad_management.academies.get(&id) else {
        return vec![];
    };
    if pool.scout_candidates >= 3
        || NaiveDate::parse_from_str(&pool.expires_on, "%Y-%m-%d")
            .map_or(true, |end| game.clock.current_date.date_naive() > end)
    {
        return vec![];
    }
    let cycle = pool.cycle;
    let first = pool.scout_candidates;
    let mut found = Vec::new();
    let position = target
        .cloned()
        .unwrap_or(domain::player::Position::Midfielder);
    for slot in first..3 {
        let mut player = generate_prospect(
            game,
            &team,
            &position,
            &format!("academy-scout-{id}-{cycle}-{slot}"),
        );
        if let Some(nation) = nationality {
            player.nationality = nation.into();
            player.football_nation = domain::identity::normalize_football_nation_code(nation);
            player.birth_country = domain::identity::derive_birth_country_code(nation);
        }
        let candidate = generation::candidate(player, level(&team));
        found.push(candidate.player.clone());
        game.squad_management
            .academies
            .get_mut(&id)
            .unwrap()
            .candidates
            .push(candidate);
    }
    game.squad_management
        .academies
        .get_mut(&id)
        .unwrap()
        .scout_candidates = 3;
    found
}

#[cfg(test)]
mod tests;
