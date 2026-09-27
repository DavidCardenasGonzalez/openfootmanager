#!/usr/bin/env python3
"""
Build a current 2026/27 Big Five squad dataset for Open Manager.

Source access: DataFC -> Sofascore.
No Football Manager installation or save is required.

Output:
  <project>/data/top5-source/raw/
    players.json
    clubs.json
    competitions.json
    league-tables.json
    contracts.json
    manifest.json
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT = Path(
    os.environ.get("OPEN_MANAGER_PROJECT", Path.home() / "openfootmanager")
).expanduser().resolve()

OUT = PROJECT / "data" / "top5-source" / "raw"

LEAGUES = [
    {
        "key": "premier-league",
        "name": "Premier League",
        "country": "England",
        "tournament_id": 17,
    },
    {
        "key": "laliga",
        "name": "LaLiga",
        "country": "Spain",
        "tournament_id": 8,
    },
    {
        "key": "serie-a",
        "name": "Serie A",
        "country": "Italy",
        "tournament_id": 23,
    },
    {
        "key": "bundesliga",
        "name": "Bundesliga",
        "country": "Germany",
        "tournament_id": 35,
    },
    {
        "key": "ligue-1",
        "name": "Ligue 1",
        "country": "France",
        "tournament_id": 34,
    },
]


def ensure_datafc():
    try:
        import datafc  # noqa: F401
        return
    except ImportError:
        print("Installing DataFC...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--upgrade", "datafc"]
        )


def configure_sofascore_http():
    """Patch DataFC's shared curl_cffi client for current Sofascore challenges."""
    from curl_cffi import requests as curl_requests
    from datafc.utils import _client as datafc_client

    datafc_client.SOFASCORE_HEADERS.update(
        {
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.sofascore.com/",
        }
    )

    url = "https://api.sofascore.com/api/v1/unique-tournament/17/seasons"
    response = curl_requests.get(
        url,
        impersonate="chrome",
        headers={
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.sofascore.com/",
        },
        timeout=30,
    )
    if response.status_code == 403:
        raise RuntimeError(
            "Sofascore returned HTTP 403 challenge even with curl_cffi Chrome "
            "impersonation and X-Requested-With. Check network/IP access."
        )
    if response.status_code != 200:
        raise RuntimeError(
            f"Sofascore seasons probe failed with HTTP {response.status_code}: {url}"
        )
    payload = response.json()
    if not isinstance(payload, dict) or "seasons" not in payload:
        raise RuntimeError("Sofascore seasons probe returned an unexpected JSON payload")
    print("Sofascore HTTP probe: OK (curl_cffi Chrome + X-Requested-With)")


def value(v):
    """Convert pandas/numpy values into JSON-safe Python values."""
    if v is None:
        return None

    try:
        # pandas NaN / NA
        import pandas as pd

        if pd.isna(v):
            return None
    except Exception:
        pass

    # numpy scalars
    if hasattr(v, "item"):
        try:
            return v.item()
        except Exception:
            pass

    if isinstance(v, (str, int, float, bool)):
        return v

    return str(v)


def records(df):
    return [
        {str(k): value(v) for k, v in row.items()}
        for row in df.to_dict(orient="records")
    ]


def pick(row, *keys):
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def find_2026_27_season(seasons_df):
    rows = records(seasons_df)

    def is_target(row):
        combined = " ".join(
            str(row.get(k) or "")
            for k in ("season_name", "season_year", "name", "year")
        ).lower()
        return (
            "26/27" in combined
            or "2026/27" in combined
            or "2026-27" in combined
            or "2026/2027" in combined
            or "2026-2027" in combined
        )

    candidates = [r for r in rows if is_target(r)]

    if not candidates:
        raise RuntimeError(
            "Could not find the 2026/27 season. "
            f"Available rows: {json.dumps(rows[:10], ensure_ascii=False)}"
        )

    candidate = candidates[0]
    season_id = candidate.get("season_id") or candidate.get("id")
    if season_id is None:
        raise RuntimeError(f"Season row has no ID: {candidate}")

    return int(season_id), candidate


def main():
    if not PROJECT.exists():
        raise SystemExit(
            f"Open Manager project not found at:\n  {PROJECT}\n\n"
            "Set OPEN_MANAGER_PROJECT if the repository is elsewhere."
        )

    ensure_datafc()
    configure_sofascore_http()

    from datafc import seasons_data, standings_data, squad_data

    OUT.mkdir(parents=True, exist_ok=True)

    all_players = []
    all_clubs = []
    all_competitions = []
    all_tables = []
    all_contracts = []

    print("=== Open Manager · Big Five 2026/27 extractor ===")
    print(f"Project: {PROJECT}")
    print(f"Output:  {OUT}")
    print()

    for league in LEAGUES:
        print(f"[{league['country']}] {league['name']}")

        try:
            seasons = seasons_data(tournament_id=league["tournament_id"])
        except Exception as exc:
            if "HTTP 403" in str(exc):
                raise RuntimeError(
                    "Sofascore returned an HTTP 403 challenge through DataFC "
                    "after the curl_cffi header patch."
                ) from exc
            raise
        season_id, season_meta = find_2026_27_season(seasons)

        print(f"  season_id: {season_id}")

        standings = standings_data(
            tournament_id=league["tournament_id"],
            season_id=season_id,
        )

        # DataFC returns Total/Home/Away. Use Total as the canonical team list.
        if "category" in standings.columns:
            overall = standings[
                standings["category"].astype(str).str.lower() == "total"
            ].copy()
            if overall.empty:
                overall = standings.drop_duplicates(subset=["team_id"]).copy()
        else:
            overall = standings.drop_duplicates(subset=["team_id"]).copy()

        overall = overall.drop_duplicates(subset=["team_id"])

        squads = squad_data(standings_df=overall)

        table_rows = records(overall)
        squad_rows = records(squads)

        competition = {
            "id": f"sofascore:tournament:{league['tournament_id']}:season:{season_id}",
            "source": "sofascore",
            "tournamentId": league["tournament_id"],
            "seasonId": season_id,
            "name": league["name"],
            "country": league["country"],
            "season": "2026/27",
            "sourceSeason": season_meta,
        }
        all_competitions.append(competition)

        clubs_by_id = {}

        for row in table_rows:
            team_id = row.get("team_id")
            if team_id is None:
                continue

            club_id = f"sofascore:team:{team_id}"

            club = {
                "id": club_id,
                "source": "sofascore",
                "sourceTeamId": team_id,
                "name": row.get("team_name"),
                "country": league["country"],
                "competitionId": competition["id"],
                "competitionName": league["name"],
                "season": "2026/27",
                "sourceLeaguePosition": row.get("position"),
                "matches": row.get("matches"),
                "wins": row.get("wins"),
                "draws": row.get("draws"),
                "losses": row.get("losses"),
                "goalsFor": row.get("scores_for"),
                "goalsAgainst": row.get("scores_against"),
                "points": row.get("points"),
                "sourceData": row,
            }

            clubs_by_id[team_id] = club
            all_clubs.append(club)

            all_tables.append(
                {
                    "competitionId": competition["id"],
                    "clubId": club_id,
                    "position": row.get("position"),
                    "matches": row.get("matches"),
                    "wins": row.get("wins"),
                    "draws": row.get("draws"),
                    "losses": row.get("losses"),
                    "goalsFor": row.get("scores_for"),
                    "goalsAgainst": row.get("scores_against"),
                    "points": row.get("points"),
                }
            )

        league_players = 0

        for row in squad_rows:
            player_id = row.get("player_id")
            team_id = row.get("team_id")

            if player_id is None or team_id is None:
                continue

            club = clubs_by_id.get(team_id)
            if club is None:
                # Do not import players for a team that isn't in the canonical
                # current top-division standings.
                continue

            stable_player_id = f"sofascore:player:{player_id}"

            player = {
                "id": stable_player_id,
                "source": "sofascore",
                "sourcePlayerId": player_id,
                "name": row.get("player_name"),
                "clubId": club["id"],
                "clubName": club["name"],
                "competitionId": competition["id"],
                "competitionName": league["name"],
                "country": league["country"],
                "age": row.get("age"),
                "heightCm": row.get("height"),
                "weightKg": pick(row, "weight", "weight_kg", "weightKg"),
                "nationality": row.get("player_country"),
                "position": row.get("position"),
                "preferredFoot": row.get("preferred_foot"),
                "contractUntil": row.get("contract_until"),
                "marketValue": row.get("market_value"),
                "marketCurrency": row.get("market_currency"),
                "sourceData": row,
            }

            all_players.append(player)
            league_players += 1

            if row.get("contract_until") is not None:
                all_contracts.append(
                    {
                        "playerId": stable_player_id,
                        "clubId": club["id"],
                        "contractUntil": row.get("contract_until"),
                        "marketValue": row.get("market_value"),
                        "marketCurrency": row.get("market_currency"),
                    }
                )

        print(
            f"  clubs: {len(clubs_by_id):>2} | "
            f"players: {league_players:>3}"
        )

    # Stable deterministic order.
    all_competitions.sort(key=lambda x: (x["country"], x["name"]))
    all_clubs.sort(key=lambda x: (x["competitionName"], x["name"] or "", x["id"]))
    all_players.sort(key=lambda x: (x["clubName"] or "", x["name"] or "", x["id"]))
    all_tables.sort(key=lambda x: (x["competitionId"], x["position"] or 999, x["clubId"]))
    all_contracts.sort(key=lambda x: (x["clubId"], x["playerId"]))

    # Detect accidental duplicate source IDs.
    player_ids = [p["id"] for p in all_players]
    club_ids = [c["id"] for c in all_clubs]

    duplicate_player_ids = sorted(
        {x for x in player_ids if player_ids.count(x) > 1}
    )
    duplicate_club_ids = sorted(
        {x for x in club_ids if club_ids.count(x) > 1}
    )

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Sofascore via DataFC",
        "season": "2026/27",
        "competitions": len(all_competitions),
        "clubs": len(all_clubs),
        "players": len(all_players),
        "duplicatePlayerIds": duplicate_player_ids,
        "duplicateClubIds": duplicate_club_ids,
        "notes": [
            "This is not Football Manager data.",
            "DataFC is used as the extraction client.",
            "Original provider data is fetched from Sofascore.",
            "Review provider terms before redistributing raw provider data in a shipped product.",
        ],
    }

    outputs = {
        "players.json": all_players,
        "clubs.json": all_clubs,
        "competitions.json": all_competitions,
        "league-tables.json": all_tables,
        "contracts.json": all_contracts,
        "manifest.json": manifest,
    }

    for filename, payload in outputs.items():
        path = OUT / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    print()
    print("Generated:")
    for filename in outputs:
        path = OUT / filename
        print(f"  {path.relative_to(PROJECT)} ({path.stat().st_size / 1024:.1f} KB)")

    print()
    print(
        f"TOTAL: {len(all_clubs)} clubs / "
        f"{len(all_players)} players / "
        f"{len(all_competitions)} competitions"
    )

    if duplicate_player_ids or duplicate_club_ids:
        print("WARNING: duplicate source IDs found. Inspect manifest.json.")
    else:
        print("Stable source IDs: OK")

    print()
    print("Next step for Codex:")
    print(
        "Run the existing importer against data/top5-source/raw "
        "to data/top5-source/raw, then run the Open Manager world generation."
    )


if __name__ == "__main__":
    main()
