//! Versioned diagnostic recordings of the live engine, independent of save files.
use crate::live_match_manager::{LiveMatchSession, MatchMode};
use engine::ai::AiProfile;
use engine::{
    LiveMatchState, MatchCommand, MatchConfig, MatchPhase, MatchSnapshot, MinuteResult, Side,
};
use rand::{SeedableRng, rngs::StdRng};
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::{self, BufRead, BufReader, Write},
    path::Path,
};

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Header {
    pub format_version: u32,
    pub build: String,
    pub engine_fingerprint: String,
    pub rng: String,
    // Decimal string preserves all 64 bits in JavaScript consumers.
    pub seed: String,
    pub initial: Option<MatchSnapshot>,
    pub config: MatchConfig,
    pub user_side: Option<Side>,
    pub ai_home: AiProfile,
    pub ai_away: AiProfile,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Entry {
    pub kind: String,
    pub command: Option<MatchCommand>,
    pub result: Option<MinuteResult>,
    pub snapshot: Option<MatchSnapshot>,
    pub ai_commands: Vec<MatchCommand>,
}

pub(crate) struct Recorder(File);
impl Recorder {
    fn write(&mut self, value: &impl Serialize) -> io::Result<()> {
        let mut bytes = serde_json::to_vec(value)?;
        bytes.push(b'\n');
        self.0.write_all(&bytes)?;
        self.0.flush()
    }
}

impl LiveMatchSession {
    pub fn start_recording(&mut self, path: &Path, build: &str) -> io::Result<()> {
        if self.recorder.is_some() || self.match_state.phase() != MatchPhase::PreKickOff {
            return Err(io::Error::other(
                "recording must start once, before kickoff",
            ));
        }
        let header = Header {
            format_version: 1,
            build: build.into(),
            engine_fingerprint: engine_fingerprint(),
            rng: "StdRng/rand-0.10".into(),
            seed: self.rng_seed.to_string(),
            initial: Some(self.snapshot()),
            config: self.match_state.config().clone(),
            user_side: self.user_side,
            ai_home: self.ai_home.clone(),
            ai_away: self.ai_away.clone(),
        };
        let mut recorder = Recorder(OpenOptions::new().write(true).create_new(true).open(path)?);
        recorder.write(&header)?;
        self.recorder = Some(recorder);
        Ok(())
    }

    pub(crate) fn record(&mut self, entry: Entry) {
        if let Some(recorder) = self.recorder.as_mut()
            && let Err(error) = recorder.write(&entry)
        {
            // Diagnostics must never abort the user's match. A truncated line
            // remains invalid and is rejected by the reader, not silently skipped.
            log::error!("Match recording stopped: {error}");
            self.recorder = None;
        }
    }
}

pub struct Recording {
    pub header: Header,
    pub entries: Vec<Entry>,
}

impl Recording {
    pub fn read(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 {
            return Err("recording exceeds 64 MiB".into());
        }
        let mut lines = BufReader::new(file).lines();
        let header = lines
            .next()
            .ok_or("missing recording header")?
            .map_err(|e| e.to_string())?;
        let header: Header = serde_json::from_str(&header).map_err(|e| e.to_string())?;
        if header.format_version != 1 || header.initial.is_none() {
            return Err("unsupported or incomplete recording header".into());
        }
        let mut entries = Vec::new();
        for (index, line) in lines.enumerate() {
            if index >= 4096 {
                return Err("too many recording entries".into());
            }
            let line = line.map_err(|e| e.to_string())?;
            let entry: Entry = serde_json::from_str(&line)
                .map_err(|e| format!("invalid recording line {}: {e}", index + 2))?;
            if entry.snapshot.is_none()
                || match entry.kind.as_str() {
                    "step" => entry.result.is_none(),
                    "command" => entry.command.is_none(),
                    _ => true,
                }
            {
                return Err(format!("incomplete recording line {}", index + 2));
            }
            entries.push(entry);
        }
        Ok(Self { header, entries })
    }

    /// Last recorded state at this minute, including commands and phase changes.
    pub fn at_minute(&self, minute: u8) -> Option<&MatchSnapshot> {
        self.entries
            .iter()
            .rev()
            .filter_map(|e| e.snapshot.as_ref())
            .find(|s| s.current_minute == minute)
            .or_else(|| {
                self.header
                    .initial
                    .as_ref()
                    .filter(|s| s.current_minute == minute)
            })
    }

    pub fn verify_with_build(&self, build: &str) -> Result<MatchSnapshot, String> {
        if self.header.build != build {
            return Err("recording build differs".into());
        }
        self.verify()
    }

    /// Re-run the real LiveMatchSession, including its AI and RNG consumption.
    pub fn verify(&self) -> Result<MatchSnapshot, String> {
        if self.header.engine_fingerprint != engine_fingerprint()
            || self.header.rng != "StdRng/rand-0.10"
        {
            return Err("engine version differs; inspect recorded snapshots instead".into());
        }
        let initial = self
            .header
            .initial
            .as_ref()
            .ok_or("missing initial state")?;
        if initial.phase != MatchPhase::PreKickOff {
            return Err("recording starts after kickoff".into());
        }
        let mut match_state = LiveMatchState::new(
            initial.home_team.clone(),
            initial.away_team.clone(),
            self.header.config.clone(),
            initial.home_bench.clone(),
            initial.away_bench.clone(),
            initial.allows_extra_time,
        );
        for (side, roles) in [
            (Side::Home, &initial.home_set_pieces),
            (Side::Away, &initial.away_set_pieces),
        ] {
            for command in [
                roles.captain.as_ref().map(|id| MatchCommand::SetCaptain {
                    side,
                    player_id: id.clone(),
                }),
                roles
                    .penalty_taker
                    .as_ref()
                    .map(|id| MatchCommand::SetPenaltyTaker {
                        side,
                        player_id: id.clone(),
                    }),
                roles
                    .free_kick_taker
                    .as_ref()
                    .map(|id| MatchCommand::SetFreeKickTaker {
                        side,
                        player_id: id.clone(),
                    }),
                roles
                    .corner_taker
                    .as_ref()
                    .map(|id| MatchCommand::SetCornerTaker {
                        side,
                        player_id: id.clone(),
                    }),
            ]
            .into_iter()
            .flatten()
            {
                match_state.apply_command(command)?;
            }
        }
        let seed = self
            .header
            .seed
            .parse()
            .map_err(|_| "invalid random seed")?;
        let mut session = LiveMatchSession {
            match_state,
            rng: StdRng::seed_from_u64(seed),
            rng_seed: seed,
            recorder: None,
            mode: MatchMode::Live,
            fixture_index: 0,
            competition_id: String::new(),
            round_matchday: 0,
            round_previous_standings: Vec::new(),
            home_team_id: initial.home_team.id.clone(),
            away_team_id: initial.away_team.id.clone(),
            user_side: self.header.user_side,
            ai_home: self.header.ai_home.clone(),
            ai_away: self.header.ai_away.clone(),
        };
        if !same_snapshot(initial, &session.snapshot())? {
            return Err("initial state divergence".into());
        }
        for (index, entry) in self.entries.iter().enumerate() {
            match entry.kind.as_str() {
                "step" => {
                    let (actual, ai_commands) = session.step_with_ai();
                    if serde_json::to_value(ai_commands).map_err(|e| e.to_string())?
                        != serde_json::to_value(&entry.ai_commands).map_err(|e| e.to_string())?
                    {
                        return Err(format!("AI command divergence at entry {}", index + 1));
                    }
                    let expected = entry.result.as_ref().ok_or("missing step result")?;
                    if serde_json::to_value(actual).map_err(|e| e.to_string())?
                        != serde_json::to_value(expected).map_err(|e| e.to_string())?
                    {
                        return Err(format!(
                            "event divergence at entry {}, minute {}",
                            index + 1,
                            expected.minute
                        ));
                    }
                }
                "command" => {
                    session.apply_command(entry.command.clone().ok_or("missing command")?)?
                }
                _ => return Err("unknown recording entry".into()),
            }
            let expected = entry.snapshot.as_ref().ok_or("missing snapshot")?;
            if !same_snapshot(expected, &session.snapshot())? {
                return Err(format!(
                    "state divergence at entry {}, minute {}",
                    index + 1,
                    expected.current_minute
                ));
            }
        }
        Ok(session.snapshot())
    }
}

fn same_snapshot(a: &MatchSnapshot, b: &MatchSnapshot) -> Result<bool, String> {
    fn value(snapshot: &MatchSnapshot) -> Result<serde_json::Value, String> {
        let mut value = serde_json::to_value(snapshot).map_err(|e| e.to_string())?;
        // HashSet iteration order is intentionally not part of replay identity.
        if let Some(sent_off) = value["sent_off"].as_array_mut() {
            sent_off.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
        }
        Ok(value)
    }
    Ok(value(a)? == value(b)?)
}

/// Fingerprint the compiled sources, not the working directory at playback time.
pub fn engine_fingerprint() -> String {
    env!("OFM_RECORDING_FINGERPRINT").to_string()
}
