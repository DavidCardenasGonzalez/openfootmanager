use super::{AcademyCandidate, Game};
use chrono::Datelike;
use domain::{
    player::{Player, PlayerAttributes, Position},
    team::Team,
};
use rand::{RngExt, SeedableRng, rngs::StdRng};
use std::hash::{Hash, Hasher};

pub struct AcademyPolicy {
    pub candidates: usize,
    pub signings: u8,
    pub wonderkid_basis_points: u32,
}

pub fn level(team: &Team) -> u8 {
    team.facilities.youth.clamp(1, 5)
}

pub fn policy(level: u8) -> AcademyPolicy {
    let i = level.clamp(1, 5) as usize - 1;
    AcademyPolicy {
        candidates: [6, 8, 10, 12, 14][i],
        signings: [2, 2, 3, 3, 4][i],
        wonderkid_basis_points: [40, 50, 65, 80, 100][i],
    }
}

pub fn club_level(game: &Game, team: &Team) -> i32 {
    let mut ratings: Vec<_> = game
        .players
        .iter()
        .filter(|p| !p.retired && p.team_id.as_deref() == Some(&team.id))
        .map(|p| i32::from(p.ovr))
        .collect();
    ratings.sort_unstable_by(|a, b| b.cmp(a));
    let n = ratings.len().min(11);
    if n == 0 {
        55
    } else {
        (ratings.iter().take(n).sum::<i32>() / n as i32).clamp(45, 76)
    }
}

fn rng_for(id: &str) -> StdRng {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut hasher);
    StdRng::seed_from_u64(hasher.finish())
}

pub fn generate_prospect(game: &Game, team: &Team, position: &Position, id: &str) -> Player {
    // The original human manager identifies the career and survives club changes/save reloads.
    let mut rng = rng_for(&format!("{}:{id}", game.manager_id));
    let year = game.clock.current_date.year() as u32;
    let mut p = crate::generator::generate_youth_academy_recruit_with_rng(
        team,
        Some(position),
        None,
        year,
        &mut rng,
    );
    p.id = id.into();
    p.date_of_birth = format!("{}-01-01", year - rng.random_range(16..=18));
    let academy = i32::from(level(team));
    let club = club_level(game, team);
    let spread = 8 - academy;
    let target = (club - 18 + 2 * academy + rng.random_range(-spread..=spread)).clamp(35, 72);
    // Absolute, bounded potential prevents a self-reinforcing top-XI → elite-potential loop.
    let club_bonus = ((club - 60) / 10).clamp(-2, 2);
    let ceiling = if rng.random_range(0..10_000) < policy(level(team)).wonderkid_basis_points {
        rng.random_range(90..=95)
    } else {
        let draw = rng.random_range(0..100);
        let raw = match draw {
            0..=64 => rng.random_range(60..=75),
            65..=91 => rng.random_range(73..=81),
            _ => rng.random_range(82..=87),
        };
        (raw + (academy - 1) + club_bonus).clamp(55, 89) as u8
    }
    .max((club - 11).clamp(55, 65) as u8);
    set_quality(&mut p, target.min(i32::from(ceiling) - 4), year);
    p.potential = ceiling.max(p.ovr);
    crate::player_rating::refresh_player_derived(&mut p, year);
    p.market_value = u64::from(p.ovr).pow(2) * 200;
    let margin = (team.wage_budget - crate::finances::calc_annual_wages(game, &team.id)).max(0);
    p.wage = (margin / crate::ai_squad::MAX_SQUAD_SIZE as i64).clamp(0, 5000) as u32;
    p.jersey_number = crate::roster::resolve_jersey_for(game, &p, team);
    p
}

fn set_quality(player: &mut Player, target: i32, year: u32) {
    let delta = target - crate::player_rating::natural_ovr(player).round() as i32;
    shift_attributes(&mut player.attributes, delta);
    // Critical-attribute penalties are nonlinear: a uniform shift alone can undershoot.
    while crate::player_rating::natural_ovr(player).round() < f64::from(target) {
        shift_attributes(&mut player.attributes, 1);
    }
    // Keep the one-point rounding tolerance bounded by the absolute intake ceiling.
    while crate::player_rating::natural_ovr(player).round() > f64::from((target + 1).min(72)) {
        shift_attributes(&mut player.attributes, -1);
    }
    // Do not let the base generator's unrelated potential roll survive calibration.
    player.potential = 99;
    crate::player_rating::refresh_player_derived(player, year);
}

fn shift_attributes(a: &mut PlayerAttributes, delta: i32) {
    for v in [
        &mut a.pace,
        &mut a.stamina,
        &mut a.strength,
        &mut a.agility,
        &mut a.passing,
        &mut a.shooting,
        &mut a.tackling,
        &mut a.dribbling,
        &mut a.defending,
        &mut a.positioning,
        &mut a.vision,
        &mut a.decisions,
        &mut a.composure,
        &mut a.aggression,
        &mut a.teamwork,
        &mut a.leadership,
        &mut a.handling,
        &mut a.reflexes,
        &mut a.aerial,
    ] {
        *v = (i32::from(*v) + delta).clamp(1, 99) as u8;
    }
}

pub(super) fn candidate(mut player: Player, level: u8) -> AcademyCandidate {
    let mut rng = rng_for(&format!("report-{}", player.id));
    let radius = 10 - level.clamp(1, 5);
    let center = (i32::from(player.potential) + rng.random_range(-3..=3)).clamp(1, 99) as u8;
    let annual_wage = 2000 + u32::from(player.ovr) * 100;
    let signing_fee = 10_000
        + i64::from(player.ovr).pow(2) * 5
        + i64::from(player.potential.saturating_sub(player.ovr)) * 250;
    player.team_id = None;
    player.contract_end = None;
    player.wage = 0;
    player.jersey_number = None;
    AcademyCandidate {
        player,
        potential_low: center.saturating_sub(radius),
        potential_high: center.saturating_add(radius).min(99),
        signing_fee,
        annual_wage,
    }
}

pub fn generate_candidates(game: &Game, team: &Team, cycle: u32) -> Vec<AcademyCandidate> {
    let positions = [
        Position::Goalkeeper,
        Position::Defender,
        Position::Midfielder,
        Position::Forward,
    ];
    let mut candidates: Vec<_> = (0..policy(level(team)).candidates)
        .map(|slot| {
            let id = format!("academy-candidate-{}-{cycle}-{slot}", team.id);
            candidate(
                generate_prospect(game, team, &positions[(slot + cycle as usize) % 4], &id),
                level(team),
            )
        })
        .collect();
    // Every generation offers a practical project/rotation option. This floor never creates elite potential.
    let useful = (club_level(game, team) - 10).clamp(40, 66) as u8;
    let best = candidates.iter_mut().max_by_key(|c| c.player.ovr).unwrap();
    if best.player.ovr < useful {
        let pot = best.player.potential.max(useful.saturating_add(6)).max(65);
        set_quality(
            &mut best.player,
            i32::from(useful),
            game.clock.current_date.year() as u32,
        );
        best.player.potential = pot;
        crate::player_rating::refresh_player_derived(
            &mut best.player,
            game.clock.current_date.year() as u32,
        );
        *best = candidate(best.player.clone(), level(team));
    } else if !candidates.iter().any(|c| c.player.potential >= 65) {
        candidates[0].player.potential = 65;
        candidates[0] = candidate(candidates[0].player.clone(), level(team));
    }
    candidates
}

pub(super) fn empty_player() -> Player {
    let a = PlayerAttributes {
        pace: 30,
        stamina: 30,
        strength: 30,
        agility: 30,
        passing: 30,
        shooting: 30,
        tackling: 30,
        dribbling: 30,
        defending: 30,
        positioning: 30,
        vision: 30,
        decisions: 30,
        composure: 30,
        aggression: 30,
        teamwork: 30,
        leadership: 30,
        handling: 30,
        reflexes: 30,
        aerial: 30,
    };
    Player::new(
        String::new(),
        String::new(),
        String::new(),
        "2000-01-01".into(),
        "England".into(),
        Position::Midfielder,
        a,
    )
}
