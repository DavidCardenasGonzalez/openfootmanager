# Open Manager imported world

`data/top5-source/raw/` is development-only input. The current source adapter reads
`data/eafc26-source/data/players.csv` from the EAFC26-DataHub checkout and writes the
normalized JSON files there:

```sh
python3 scripts/import-eafc26-top5.py
```

The adapter filters by the five authoritative EA FC league IDs, preserves every raw
player column in `sourceData`, and emits `clubs.json`, `players.json`,
`competitions.json`, `league-tables.json`, `contracts.json`, and `manifest.json`.
The same directory can also receive equivalent DataFC/Sofascore exports in the future.
After generating or replacing those files, run:

```sh
npm run import:top5
```

The importer writes `data/open-manager/world.json` and
`data/open-manager/import-report.json`. It selects only England, Spain, Italy,
Germany, and France top divisions, preserves source IDs as stable runtime IDs,
maps each player to the imported club, and ranks clubs deterministically by
source reputation (then stable ID). Runtime startup turns the ranked clubs into
`ceil(clubCount / 20)` Open Manager divisions; the last division may be smaller.
The world's `ovr` field is left at zero so the game calculates it from the
imported attributes and natural position when loading. The EA FC overall stays
in `media.source_data` as a calibration reference only.
When present in the source player export, `skinTone`, `hairColor`, `hairLength`,
`height`, and `weight` are retained in the player's persisted `media` metadata
for future portrait and profile features.

The app consumes only the transformed world JSON. It does not need the raw
exports or any external tooling at runtime. To update the database, replace the
source checkout or raw exports, rerun the adapter if needed, then rerun the importer;
stable source IDs keep existing mappings reconcilable. Adding another real-world
league later means extending the adapter's target competition mapping and rerunning
the same pipeline, not changing the gameplay model.
