"""Offline calibration only: python scripts/calibrate-market-values.py <players.json>.

Requires NumPy. Source prices never participate in runtime valuation. Fit log prices
to the stored, position-weighted OVR, age at the source snapshot, and position.
"""
import datetime
import json
import sys

import numpy as np

KNOTS = [50, 60, 70, 75, 80, 85, 90]
GROUPS = {
    "Goalkeeper": "GK", "Defender": "CB", "CenterBack": "CB",
    "LeftBack": "FB", "RightBack": "FB", "LeftWingBack": "FB", "RightWingBack": "FB",
    "Midfielder": "CM", "CentralMidfielder": "CM", "DefensiveMidfielder": "CM",
    "AttackingMidfielder": "AM", "LeftMidfielder": "AM", "RightMidfielder": "AM",
    "Forward": "FW", "Striker": "FW", "LeftWinger": "FW", "RightWinger": "FW",
}


def source_age(player):
    source = player.get("media", {}).get("source_data") or {}
    # Do not pair historical prices with age at game start or the machine clock.
    try:
        snapshot = datetime.date.fromisoformat(source["fifa_update_date"])
        dob = datetime.date.fromisoformat(player["date_of_birth"])
    except (KeyError, ValueError, TypeError):
        return None
    return snapshot.year - dob.year - ((snapshot.month, snapshot.day) < (dob.month, dob.day))


def features(player, age):
    rating = player["ovr"]
    i = min(len(KNOTS) - 2, max(0, int(np.searchsorted(KNOTS, rating)) - 1))
    t = (rating - KNOTS[i]) / (KNOTS[i + 1] - KNOTS[i])
    row = [0.0] * len(KNOTS)
    row[i], row[i + 1] = 1 - t, t
    group = GROUPS[player["natural_position"]]
    return row + [(age - 25) / 10, max(0, age - 28) / 10, max(0, age - 32) / 10] + [
        int(group == name) for name in ["GK", "CB", "FB", "AM", "FW"]
    ]


def main():
    with open(sys.argv[1], encoding="utf-8") as handle:
        players = json.load(handle)
    samples = [(p, source_age(p)) for p in players if p.get("market_value", 0) > 0]
    samples = [(p, age) for p, age in samples if age is not None]
    x = np.array([features(p, age) for p, age in samples])
    y = np.log([p["market_value"] for p, _ in samples])
    coefficients = np.linalg.lstsq(x, y, rcond=None)[0]
    error = np.exp(abs(x @ coefficients - y))
    print("Samples:", len(samples))
    print("Log rating anchors:", coefficients[:7].tolist())
    print("Age coefficients:", coefficients[7:10].tolist())
    print("Position factors (GK, CB, FB, AM, FW; CM=1):", np.exp(coefficients[10:]).tolist())
    print("Median / p90 multiplicative error:", np.percentile(error, [50, 90]).tolist())


if __name__ == "__main__":
    main()
