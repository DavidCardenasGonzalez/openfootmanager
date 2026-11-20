# Player market values

Every active player uses the same deterministic valuation, including imported
players, free agents, national-team replacements and academy prospects. Club,
contract, source price, source age, reputation and random potential do not enter
the valuation. Transfer negotiations still apply their own price modifiers.

The inputs are current position-weighted attributes (through `natural_ovr`),
natural position and completed years of age on the game date. The model
interpolates **log** prices between rating anchors and applies age and position
factors. Outside the anchor range it extrapolates the nearest segment; prices
remain positive and increase with rating. Age is bounded to 16–60 for pricing;
invalid or future birth dates use age 30. Retired players have value zero.

Values refresh when a game is created, an existing save is loaded, before the
daily transfer sweep, after normal/live-match day advancement and at season
rollover. Loading a save writes corrected values back through the existing save
upgrade mechanism. No new save fields or SQLite migrations are needed.
World imports/exports are valued at their snapshot date, or July 1 of the base
year (the normal opening-year fallback when metadata is absent). Once in a
career the game clock takes precedence. Generators use July 1 of their opening
year until the career supplies its exact date.

## Calibration

The reference is `src-tauri/exported_world.shards/players.json`. Run:

```sh
python scripts/calibrate-market-values.py src-tauri/exported_world.shards/players.json
```

The offline script requires NumPy. It fits least squares in log-price space on
2,677 positive-price records with valid `media.source_data.fifa_update_date`.
Age is calculated from birth date **at that source date**, rather than at the
later career date. The original source metadata is preserved for reference;
runtime calculation never reads its price or age.

Log-price anchors for ratings 50, 60, 70, 75, 80, 85, 90 and the fitted age and
position coefficients are recorded in `ofm_core/src/player_value.rs`. Central
and defensive midfield are the reference position group. Other groups are
goalkeepers, centre backs, fullbacks/wingbacks, attacking/wide midfielders and
forwards/wingers. These are empirical coefficients for this game's positional
rating system, not a claim about FIFA's proprietary formula.

On the calibration sample the median multiplicative error is 1.233 and the
90th percentile is 1.695. These are in-sample approximation errors, not validation
on unseen data. The model deliberately smooths differences unexplained by age,
position and attributes. It does not reproduce every authored price or infer a
year of attribute development from an old snapshot. Generated wage scales are
kept separate from this valuation model.
