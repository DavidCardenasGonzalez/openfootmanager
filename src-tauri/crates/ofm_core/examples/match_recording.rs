//! Inspect or verify diagnostics captured by the desktop's live engine.
use ofm_core::match_recording::Recording;
use std::path::Path;

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let path = args
        .first()
        .ok_or("usage: match_recording FILE.jsonl [--verify | --minute N | --snapshots]")?;
    let recording = Recording::read(Path::new(path))?;
    let initial = recording
        .header
        .initial
        .as_ref()
        .ok_or("missing initial state")?;
    let last = recording
        .entries
        .last()
        .and_then(|e| e.snapshot.as_ref())
        .unwrap_or(initial);
    let output = match args.get(1).map(String::as_str) {
        Some("--verify") if args.len() == 2 => {
            let snapshot = recording.verify()?;
            serde_json::json!({"verified": true, "minute": snapshot.current_minute,
                "phase": snapshot.phase, "score": [snapshot.home_score, snapshot.away_score],
                "entries": recording.entries.len()})
        }
        Some("--minute") if args.len() == 3 => {
            let minute = args[2].parse::<u8>().map_err(|_| "invalid minute")?;
            let snapshot = recording
                .at_minute(minute)
                .ok_or("minute was not recorded")?;
            serde_json::json!({"snapshot": snapshot,
                "events_this_minute": snapshot.events.iter().filter(|e| e.minute == minute).collect::<Vec<_>>(),
                "entries_this_minute": recording.entries.iter().filter(|e|
                    e.snapshot.as_ref().is_some_and(|s| s.current_minute == minute)).collect::<Vec<_>>()})
        }
        Some("--snapshots") if args.len() == 2 => serde_json::json!({
            "initial": initial,
            "snapshots": recording.entries.iter().filter_map(|e| e.snapshot.as_ref()).collect::<Vec<_>>()
        }),
        None if args.len() == 1 => serde_json::json!({
            "home": initial.home_team.name, "away": initial.away_team.name,
            "minute": last.current_minute, "phase": last.phase,
            "complete": last.phase == engine::MatchPhase::Finished,
            "score": [last.home_score, last.away_score], "events": last.events.len(),
            "user_commands": recording.entries.iter().filter(|e| e.kind == "command").count(),
            "ai_commands": recording.entries.iter().map(|e| e.ai_commands.len()).sum::<usize>(),
            "build": recording.header.build, "engine_fingerprint": recording.header.engine_fingerprint,
            "timeline": recording.entries.iter().filter_map(|e| e.result.as_ref()).collect::<Vec<_>>()
        }),
        _ => {
            return Err(
                "usage: match_recording FILE.jsonl [--verify | --minute N | --snapshots]".into(),
            );
        }
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())?
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
