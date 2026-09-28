use super::*;
use crate::{clock::GameClock, schedule};
use chrono::TimeZone;
use domain::manager::Manager;

#[test]
fn unemployed_observer_rolls_club_season_over_during_multiyear_qualifying() {
    let date = Utc.with_ymd_and_hms(2028, 5, 20, 12, 0, 0).unwrap();
    let manager = Manager::new(
        "observer".into(),
        "World".into(),
        "Observer".into(),
        "1980-01-01".into(),
        "England".into(),
    );
    let mut game = Game::new(
        GameClock::new(date),
        manager,
        vec![],
        vec![],
        vec![],
        vec![],
    );
    let mut league = schedule::generate_league("Clubs", 2027, &["a".into(), "b".into()], date);
    for f in &mut league.fixtures {
        f.status = FixtureStatus::Completed;
    }
    for standing in &mut league.standings {
        standing.played = 2;
    }
    let mut qualifying =
        schedule::generate_league("Qualifying", 2030, &["nt-eng".into(), "nt-br".into()], date);
    qualifying.kind = CompetitionType::InternationalNation;
    qualifying.scope = domain::league::CompetitionScope::International;
    game.competitions = vec![league, qualifying];
    assert!(
        is_season_complete(&game),
        "national campaigns must not postpone annual club ageing/intakes"
    );
}
