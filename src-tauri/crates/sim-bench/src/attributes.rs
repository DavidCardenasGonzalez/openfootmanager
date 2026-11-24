use engine::{
    MatchConfig, PlayStyle, PlayerData, PlayerRole, Position, TeamData, simulate_with_rng,
};
use rand::{SeedableRng, rngs::StdRng};

use crate::builder::build_team;

type Attribute = (&'static str, fn(&mut PlayerData) -> &mut u8);

const ATTRIBUTES: &[Attribute] = &[
    ("pace", |p| &mut p.pace),
    ("stamina", |p| &mut p.stamina),
    ("strength", |p| &mut p.strength),
    ("agility", |p| &mut p.agility),
    ("passing", |p| &mut p.passing),
    ("shooting", |p| &mut p.shooting),
    ("tackling", |p| &mut p.tackling),
    ("dribbling", |p| &mut p.dribbling),
    ("defending", |p| &mut p.defending),
    ("positioning", |p| &mut p.positioning),
    ("vision", |p| &mut p.vision),
    ("decisions", |p| &mut p.decisions),
    ("composure", |p| &mut p.composure),
    ("aggression", |p| &mut p.aggression),
    ("teamwork", |p| &mut p.teamwork),
    ("leadership", |p| &mut p.leadership),
    ("handling", |p| &mut p.handling),
    ("reflexes", |p| &mut p.reflexes),
    ("aerial", |p| &mut p.aerial),
];

pub(crate) fn run(games: u32, seed: u64) {
    let mut roster_rng = StdRng::seed_from_u64(seed);
    let home = neutral_team("home", &mut roster_rng);
    let away = neutral_team("away", &mut roster_rng);
    let config = MatchConfig {
        home_advantage: 1.0,
        ..MatchConfig::default()
    };
    println!("{games} games per scenario, seed {seed}, 70 → 99 on the home side");
    println!("scenario,home_win_pct,goals_for,goals_against,home_possession_pct,home_fouls");
    measure("baseline", &home, &away, &config, games, seed);
    for &(name, field) in ATTRIBUTES {
        let mut candidate = home.clone();
        let keeper_only = matches!(name, "handling" | "reflexes");
        for player in &mut candidate.players {
            if (player.position == Position::Goalkeeper) == keeper_only {
                *field(player) = 99;
                if name == "pace" {
                    player.traits.push("Speedster".into());
                }
            }
        }
        measure(name, &candidate, &away, &config, games, seed);
    }

    let mut candidate = home.clone();
    for player in &mut candidate.players {
        if player.position != Position::Goalkeeper {
            player.pace = 99;
            player.traits.push("Speedster".into());
        }
    }
    let mut technical = away.clone();
    for player in &mut technical.players {
        if player.position != Position::Goalkeeper {
            player.dribbling = 90;
            player.passing = 82;
        }
    }
    measure(
        "pace_vs_technical",
        &candidate,
        &technical,
        &config,
        games,
        seed,
    );
}

fn neutral_team(id: &str, rng: &mut StdRng) -> TeamData {
    let mut team = build_team(id, id, 70, PlayStyle::Balanced, "4-3-3", rng);
    for player in &mut team.players {
        player.role = PlayerRole::Standard;
        player.condition = 90;
        player.fitness = 75;
        for &(_, field) in ATTRIBUTES {
            *field(player) = 70;
        }
    }
    team
}

fn measure(
    name: &str,
    home: &TeamData,
    away: &TeamData,
    config: &MatchConfig,
    games: u32,
    seed: u64,
) {
    let mut wins = 0;
    let mut goals_for = 0;
    let mut goals_against = 0;
    let mut possession = 0.0;
    let mut fouls = 0;
    for game in 0..games {
        let mut rng = StdRng::seed_from_u64(seed.wrapping_add(u64::from(game)));
        // Swap ends on alternating seeds to balance the engine's kickoff order.
        let reversed = game % 2 != 0;
        let report = if reversed {
            simulate_with_rng(away, home, config, &mut rng)
        } else {
            simulate_with_rng(home, away, config, &mut rng)
        };
        let (candidate, opponent) = if reversed {
            (&report.away_stats, &report.home_stats)
        } else {
            (&report.home_stats, &report.away_stats)
        };
        wins += u32::from(candidate.goals > opponent.goals);
        goals_for += u64::from(candidate.goals);
        goals_against += u64::from(opponent.goals);
        possession += f64::from(candidate.possession_ticks)
            / f64::from(candidate.possession_ticks + opponent.possession_ticks);
        fouls += u64::from(candidate.fouls);
    }
    let games = f64::from(games);
    println!(
        "{name},{:.2},{:.3},{:.3},{:.2},{:.2}",
        f64::from(wins) / games * 100.0,
        goals_for as f64 / games,
        goals_against as f64 / games,
        possession / games * 100.0,
        fouls as f64 / games,
    );
}
