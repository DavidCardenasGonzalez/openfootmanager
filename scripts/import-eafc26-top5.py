#!/usr/bin/env python3
"""Convert the EA FC 26 DataHub CSV into the normalized Top 5 source format.

This is a source adapter only. It does not build the Open Manager world; the
existing scripts/import-top5.mjs remains responsible for that step.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "eafc26-source" / "data" / "players.csv"
OUTPUT = ROOT / "data" / "top5-source" / "raw"

# The dataset contains rows from other competitions under similar labels, so
# league IDs are the authoritative relationship rather than name matching.
TARGET_LEAGUES = {
    "13.0": {"id": "eafc26-league-13", "name": "Premier League", "country": "England", "code": "EN"},
    "53.0": {"id": "eafc26-league-53", "name": "La Liga", "country": "Spain", "code": "ES"},
    "31.0": {"id": "eafc26-league-31", "name": "Serie A", "country": "Italy", "code": "IT"},
    "19.0": {"id": "eafc26-league-19", "name": "Bundesliga", "country": "Germany", "code": "DE"},
    "16.0": {"id": "eafc26-league-16", "name": "Ligue 1", "country": "France", "code": "FR"},
}


def number(value: str | None) -> int | float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() else parsed


def annual_wage(weekly_wage: str | None) -> int | float | None:
    """Convert EA FC's weekly EUR wage into the game's annual wage unit."""
    value = number(weekly_wage)
    return value * 52 if value is not None else None


def row_source(row: dict[str, str]) -> dict[str, Any]:
    """Keep every source column, coercing numeric values for easier consumers."""
    result: dict[str, Any] = {}
    numeric = {
        "player_id", "fifa_version", "fifa_update", "overall", "potential", "value_eur", "wage_eur",
        "age", "height_cm", "weight_kg", "league_id", "league_level", "club_team_id",
        "club_jersey_number", "club_contract_valid_until_year", "nationality_id", "nation_team_id",
        "weak_foot", "skill_moves", "international_reputation", "release_clause_eur",
    }
    for key, value in row.items():
        result[key] = number(value) if key in numeric else (None if value == "" else value)
    return result


def primary_position(value: str) -> str:
    token = (value or "").split(",")[0].strip().upper()
    mapping = {
        "GK": "Goalkeeper", "CB": "Center Back", "LCB": "Center Back", "RCB": "Center Back",
        "LB": "Left Back", "LWB": "Left Back", "RB": "Right Back", "RWB": "Right Back",
        "CDM": "Defensive Midfielder", "LDM": "Defensive Midfielder", "RDM": "Defensive Midfielder",
        "CM": "Central Midfielder", "LCM": "Central Midfielder", "RCM": "Central Midfielder",
        "CAM": "Attacking Midfielder", "LAM": "Attacking Midfielder", "RAM": "Attacking Midfielder",
        "LM": "Left Wing", "LW": "Left Wing", "LF": "Left Wing",
        "RM": "Right Wing", "RW": "Right Wing", "RF": "Right Wing",
        "ST": "Striker", "LS": "Striker", "RS": "Striker", "CF": "Striker",
    }
    return mapping.get(token, "Midfielder")


def runtime_attributes(row: dict[str, str]) -> dict[str, int | float]:
    # Raw EA attributes remain untouched in sourceData. These aliases feed the
    # existing simplified simulator; absent ratings retain importer defaults.
    primary = row.get("player_positions", "").split(",")[0].strip().upper()
    is_goalkeeper = primary == "GK"
    is_defender = primary in {"CB", "LCB", "RCB", "LB", "LWB", "RB", "RWB"}
    aliases = {
        "pace": "movement_sprint_speed", "stamina": "power_stamina",
        "strength": "power_strength", "agility": "movement_agility",
        "passing": "attacking_short_passing", "shooting": "attacking_finishing",
        "tackling": "defending_standing_tackle", "dribbling": "skill_dribbling",
        "defending": "defending_marking_awareness",
        "vision": "mentality_vision", "composure": "mentality_composure",
        "aggression": "mentality_aggression", "handling": "goalkeeping_handling",
        "reflexes": "goalkeeping_reflexes",
        "decisions": "movement_reactions",
        "aerial": "attacking_heading_accuracy",
    }
    aliases["positioning"] = (
        "goalkeeping_positioning" if is_goalkeeper else
        "defending_marking_awareness" if is_defender else "mentality_positioning"
    )
    if is_goalkeeper:
        # The runtime has no separate diving/kicking fields: agility and passing
        # are their closest role-specific counterparts for keeper OVR.
        aliases["agility"] = "goalkeeping_diving"
        aliases["passing"] = "goalkeeping_kicking"
    return {target: value for target, source in aliases.items()
            if (value := number(row.get(source))) is not None}


def read_rows() -> list[dict[str, str]]:
    if not INPUT.exists():
        raise SystemExit(f"EA FC 26 source not found: {INPUT}")
    with INPUT.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    source_rows = read_rows()
    selected = [row for row in source_rows if row.get("league_id") in TARGET_LEAGUES and row.get("club_team_id")]
    if not selected:
        raise SystemExit("No players from the five target league IDs were found")

    competitions = [
        {
            "id": meta["id"], "name": meta["name"], "country": meta["country"],
            "countryCode": meta["code"], "sourceId": league_id,
            "sourceData": {"league_id": number(league_id), "league_name": meta["name"], "league_level": 1},
        }
        for league_id, meta in TARGET_LEAGUES.items()
    ]
    competition_by_league = {league_id: meta for league_id, meta in TARGET_LEAGUES.items()}

    clubs: dict[str, dict[str, Any]] = {}
    players: list[dict[str, Any]] = []
    contracts: list[dict[str, Any]] = []
    seen_players: set[str] = set()

    for row in selected:
        league_id = row["league_id"]
        meta = competition_by_league[league_id]
        club_id = row["club_team_id"]
        player_id = row["player_id"]
        source = row_source(row)
        if club_id not in clubs:
            clubs[club_id] = {
                "id": club_id, "name": row["club_name"], "shortName": row["club_name"],
                "competitionId": meta["id"], "competitionName": meta["name"],
                "countryCode": meta["code"], "country": meta["country"],
                "sourceData": {"club_team_id": number(club_id), "club_name": row["club_name"], "league_id": number(league_id), "league_name": meta["name"]},
            }
        if player_id in seen_players:
            raise SystemExit(f"Duplicate player_id in selected source: {player_id}")
        seen_players.add(player_id)
        players.append({
            "id": player_id, "name": row["long_name"] or row["short_name"],
            "shortName": row["short_name"], "fullName": row["long_name"] or row["short_name"],
            "clubId": club_id, "clubName": row["club_name"],
            "competitionId": meta["id"], "competitionName": meta["name"],
            "age": number(row.get("age")), "dateOfBirth": row.get("dob"),
            "nationality": row.get("nationality_name"), "position": primary_position(row.get("player_positions", "")),
            "positions": [item.strip() for item in row.get("player_positions", "").split(",") if item.strip()],
            "preferredFoot": row.get("preferred_foot"), "heightCm": number(row.get("height_cm")),
            "weightKg": number(row.get("weight_kg")), "overall": number(row.get("overall")),
            "currentAbility": number(row.get("overall")), "potentialAbility": number(row.get("potential")),
            "value": number(row.get("value_eur")), "marketValue": number(row.get("value_eur")),
            "wage": annual_wage(row.get("wage_eur")), "contractUntil": row.get("club_contract_valid_until_year"),
            "attributes": runtime_attributes(row), "sourceData": source,
        })
        contracts.append({
            "playerId": player_id, "clubId": club_id,
            "endDate": row.get("club_contract_valid_until_year"),
            "wage": annual_wage(row.get("wage_eur")), "value": number(row.get("value_eur")),
            "sourceData": {"player_id": number(player_id), "club_team_id": number(club_id), "club_contract_valid_until_year": number(row.get("club_contract_valid_until_year")), "wage_eur": number(row.get("wage_eur"))},
        })

    club_counts = Counter(row["clubId"] for row in players)
    league_counts = Counter(row["competitionName"] for row in players)
    league_club_counts: dict[str, int] = {}
    for club in clubs.values():
        league_club_counts[club["competitionName"]] = league_club_counts.get(club["competitionName"], 0) + 1
    league_tables = [
        {"competitionId": meta["id"], "competitionName": meta["name"], "sourceId": league_id, "teams": [
            {"clubId": club["id"], "clubName": club["name"], "rank": None}
            for club in clubs.values() if club["competitionId"] == meta["id"]
        ]}
        for league_id, meta in TARGET_LEAGUES.items()
    ]
    output = {
        "players.json": players, "clubs.json": list(clubs.values()),
        "competitions.json": competitions, "league-tables.json": league_tables,
        "contracts.json": contracts,
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, value in output.items():
        (OUTPUT / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    manifest = {
        "source": "EAFC26-DataHub", "sourceRepository": "https://github.com/ismailoksuz/EAFC26-DataHub",
        "sourceFile": str(INPUT.relative_to(ROOT)), "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSha256": hashlib.sha256(INPUT.read_bytes()).hexdigest(),
        "sourceRows": len(source_rows), "selectedPlayers": len(players), "selectedClubs": len(clubs),
        "selectedCompetitions": len(competitions), "playersPerClub": dict(sorted(club_counts.items())),
        "clubsPerCompetition": dict(sorted(league_club_counts.items())),
        "playersPerCompetition": dict(sorted(league_counts.items())),
        "fieldAvailability": {"heightCm": len([p for p in players if p["heightCm"] is not None]), "weightKg": len([p for p in players if p["weightKg"] is not None]), "bodyType": len([p for p in players if p["sourceData"].get("body_type")]), "realFace": len([p for p in players if p["sourceData"].get("real_face")])},
        "appearanceFieldsAvailable": ["body_type", "real_face", "player_face_url"],
        "appearanceFieldsMissing": ["skin_tone", "hair_color", "hair_length"],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("EA FC 26 → normalized Top 5 source generated")
    print(f"Source rows: {len(source_rows)}")
    print(f"Players selected: {len(players)}")
    print(f"Clubs selected: {len(clubs)}")
    for name, count in sorted(league_club_counts.items()):
        print(f"{name}: {count} clubs, {league_counts[name]} players")
    print(f"Height available: {manifest['fieldAvailability']['heightCm']}/{len(players)}")
    print(f"Weight available: {manifest['fieldAvailability']['weightKg']}/{len(players)}")


if __name__ == "__main__":
    main()
