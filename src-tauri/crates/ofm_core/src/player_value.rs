use chrono::NaiveDate;
use domain::player::{Player, Position};

// Offline log-price fit to 2,677 dated reference players. See
// scripts/calibrate-market-values.py and docs/MARKET_VALUES.md.
const RATING_CURVE: [(u8, f64); 7] = [
    (50, 12.371142921733439),
    (60, 13.473847142706125),
    (70, 15.09738899520588),
    (75, 16.37183866082331),
    (80, 17.60465500793751),
    (85, 18.488801126524265),
    (90, 19.357077701752292),
];

fn value_from_rating(rating: u8, age: u32, position: &Position) -> u64 {
    let i = RATING_CURVE
        .windows(2)
        .position(|pair| rating <= pair[1].0)
        .unwrap_or(RATING_CURVE.len() - 2);
    let (low, high) = (RATING_CURVE[i], RATING_CURVE[i + 1]);
    let t = (f64::from(rating) - f64::from(low.0)) / f64::from(high.0 - low.0);
    let log_base = low.1 + t * (high.1 - low.1);
    let age = f64::from(age.clamp(16, 60));
    let log_age = -0.6604952283329837 * (age - 25.0) / 10.0
        - 0.14753161135668147 * (age - 28.0).max(0.0) / 10.0
        - 1.3719800203640136 * (age - 32.0).max(0.0) / 10.0;
    let position_factor = match position {
        Position::Goalkeeper => 0.5698609646421667,
        Position::Defender | Position::CenterBack => 0.624932188728628,
        Position::RightBack
        | Position::LeftBack
        | Position::RightWingBack
        | Position::LeftWingBack => 0.7508277024832294,
        Position::Midfielder | Position::CentralMidfielder | Position::DefensiveMidfielder => 1.0,
        Position::AttackingMidfielder | Position::LeftMidfielder | Position::RightMidfielder => {
            0.6608922111804845
        }
        Position::Forward | Position::Striker | Position::LeftWinger | Position::RightWinger => {
            0.6019652289823008
        }
    };
    // Keep even very low-rated active players positive; rounded euros avoid
    // large pricing jumps at arbitrary display bands.
    ((log_base + log_age).exp() * position_factor)
        .round()
        .max(1.0) as u64
}

/// A club-independent valuation from current positional attributes and exact
/// age on the game date. Historical source prices/ages are calibration data only.
pub fn calculate_market_value(player: &Player, current_date: NaiveDate) -> u64 {
    if player.retired {
        return 0;
    }
    let age = NaiveDate::parse_from_str(&player.date_of_birth, "%Y-%m-%d")
        .ok()
        .and_then(|dob| current_date.years_since(dob))
        .unwrap_or(30);
    let position = crate::player_rating::primary_position(player);
    value_from_rating(
        crate::player_rating::natural_ovr(player).round() as u8,
        age,
        &position,
    )
}

/// Returns whether persisted prices changed, so save upgrades can be written back.
pub fn refresh_market_values(players: &mut [Player], current_date: NaiveDate) -> bool {
    let mut changed = false;
    for player in players {
        let value = calculate_market_value(player, current_date);
        changed |= player.market_value != value;
        player.market_value = value;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::player::{PlayerAttributes, Position};

    fn player() -> Player {
        Player::new(
            "p".into(),
            "Player".into(),
            "Player".into(),
            "2000-09-19".into(),
            "England".into(),
            Position::Striker,
            PlayerAttributes {
                pace: 80,
                stamina: 80,
                strength: 80,
                agility: 80,
                passing: 80,
                shooting: 80,
                tackling: 80,
                dribbling: 80,
                defending: 80,
                positioning: 80,
                vision: 80,
                decisions: 80,
                composure: 80,
                aggression: 80,
                teamwork: 80,
                leadership: 80,
                handling: 80,
                reflexes: 80,
                aerial: 80,
            },
        )
    }

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn market_value_uses_current_attributes_and_ignores_stale_prices_and_club() {
        let p = player();
        let day = date("2025-09-19");
        let expected = calculate_market_value(&p, day);
        assert!((20_000_000..35_000_000).contains(&expected));
        let mut signed = p.clone();
        signed.team_id = Some("club".into());
        signed.market_value = 999_000_000;
        signed.ovr = 1;
        signed.media.source_age = Some(19);
        assert_eq!(calculate_market_value(&signed, day), expected);
        signed.attributes.shooting = 90;
        assert!(calculate_market_value(&signed, day) > expected);
    }

    #[test]
    fn market_value_uses_birthday_at_game_date() {
        let p = player();
        let before = calculate_market_value(&p, date("2025-09-18"));
        let birthday = calculate_market_value(&p, date("2025-09-19"));
        assert!(before > birthday);
        assert_eq!(birthday, calculate_market_value(&p, date("2026-09-18")));
        assert!(birthday > calculate_market_value(&p, date("2026-09-19")));
    }

    #[test]
    fn market_value_accounts_for_natural_position_and_retirement() {
        let mut p = player();
        let day = date("2025-09-19");
        let striker = calculate_market_value(&p, day);
        p.natural_position = Position::Goalkeeper;
        p.position = Position::Goalkeeper;
        assert_ne!(calculate_market_value(&p, day), striker);
        p.retired = true;
        assert_eq!(calculate_market_value(&p, day), 0);
    }

    #[test]
    fn market_value_curve_is_positive_and_monotonic_for_all_ratings() {
        for age in [16, 25, 33, 45] {
            let mut previous = 0;
            for rating in 1..=99 {
                let value = value_from_rating(rating, age, &Position::Striker);
                assert!(value > 0 && value >= previous);
                previous = value;
            }
        }
    }
}
