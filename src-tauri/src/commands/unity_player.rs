use std::{
    path::PathBuf,
    process::Child,
    sync::{Arc, Mutex},
    time::Instant,
};

use engine::PlayStyle;
use ofm_core::state::StateManager;
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use super::unity_match::{UnityLineup, UnitySubstitution};

const UNAVAILABLE: &str = "unityMatch.playerFailed";
const TACTIC_FAILED: &str = "unityMatch.tacticFailed";
const SUB_FAILED: &str = "unityMatch.subFailed";

#[derive(Default)]
pub struct UnityPlayer(Mutex<Option<EmbeddedMatch>>);

struct EmbeddedMatch {
    child: Child,
    result: PathBuf,
    bounds: PathBuf,
    last_bounds: Option<PlayerBounds>,
    started: Instant,
    tactics: TacticsChannel,
}

// Each launch has its own directory, including retries of the same fixture.
struct TacticsChannel {
    directory: tempfile::TempDir,
    sequence: u32,
    requested: Option<LiveOrder>,
    applied: Option<AppliedTactic>,
    substitutions: Vec<UnitySubstitution>,
}

#[derive(Clone, Serialize)]
#[serde(untagged)]
enum LiveOrder {
    Tactic { play_style: PlayStyle },
    Substitution(UnitySubstitution),
}

#[derive(Clone, Copy, Deserialize, Serialize)]
struct AppliedTactic {
    #[serde(default)]
    play_style: Option<PlayStyle>,
    #[serde(default)]
    minute: u8,
}

#[derive(Serialize)]
pub struct TacticsStatus {
    ready: bool,
    substitutions_ready: bool,
    substitutions_panel: bool,
    pending: bool,
    pending_substitution: bool,
    applied: Option<AppliedTactic>,
    substitutions: Vec<UnitySubstitution>,
}

#[derive(Default, Serialize)]
pub struct UnityPlayerUpdate {
    finished: bool,
    tactics: Option<TacticsStatus>,
}

impl TacticsChannel {
    #[cfg(any(windows, test))]
    fn new() -> std::io::Result<Self> {
        Ok(Self {
            directory: tempfile::Builder::new()
                .prefix("openfoot-tactics-")
                .tempdir()?,
            sequence: 0,
            requested: None,
            applied: None,
            substitutions: Vec::new(),
        })
    }

    fn status(&mut self) -> TacticsStatus {
        if let Some(requested) = &self.requested {
            let path = self
                .directory
                .path()
                .join(format!("{}.applied.json", self.sequence));
            if let Ok(bytes) = std::fs::read(path) {
                let accepted = match requested {
                    LiveOrder::Tactic { play_style } => {
                        serde_json::from_slice::<AppliedTactic>(&bytes)
                            .ok()
                            .filter(|ack| {
                                ack.play_style == Some(*play_style)
                                    && (1..=90).contains(&ack.minute)
                            })
                            .map(|ack| self.applied = Some(ack))
                    }
                    LiveOrder::Substitution(change) => {
                        serde_json::from_slice::<UnitySubstitution>(&bytes)
                            .ok()
                            .filter(|ack| {
                                ack.player_off_id == change.player_off_id
                                    && ack.player_on_id == change.player_on_id
                                    && (1..=90).contains(&ack.minute)
                            })
                            .map(|ack| self.substitutions.push(ack))
                    }
                };
                if accepted.is_some() {
                    self.requested = None;
                }
            }
        }
        let ready = std::fs::read_to_string(self.directory.path().join("ready")).ok();
        let marker = ready.as_deref();
        TacticsStatus {
            ready: ready.is_some(),
            // "panel" means the player ships its own in-match substitution
            // panel, so the manager must keep a single visible control.
            substitutions_ready: matches!(marker, Some("substitutions") | Some("panel")),
            substitutions_panel: marker == Some("panel"),
            pending: self.requested.is_some(),
            pending_substitution: matches!(self.requested, Some(LiveOrder::Substitution(_))),
            applied: self.applied,
            substitutions: self.substitutions.clone(),
        }
    }

    fn send(&mut self, play_style: PlayStyle) -> Result<TacticsStatus, String> {
        if play_style == PlayStyle::Possession {
            return Err(TACTIC_FAILED.into());
        }
        self.send_order(LiveOrder::Tactic { play_style }, TACTIC_FAILED)
    }

    fn send_order(&mut self, order: LiveOrder, error: &str) -> Result<TacticsStatus, String> {
        let status = self.status();
        if !status.ready
            || status.pending
            || (matches!(&order, LiveOrder::Substitution(_)) && !status.substitutions_ready)
        {
            return Err(error.into());
        }
        let sequence = self.sequence + 1;
        let path = self.directory.path().join(format!("{sequence}.order.json"));
        let temporary = path.with_extension("tmp");
        let bytes = serde_json::to_vec(&order).map_err(|_| error)?;
        std::fs::write(&temporary, bytes).map_err(|_| error)?;
        std::fs::rename(temporary, path).map_err(|_| error)?;
        self.sequence = sequence;
        self.requested = Some(order);
        Ok(self.status())
    }
}

impl Drop for EmbeddedMatch {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tauri::command]
pub fn start_unity_player(
    window: WebviewWindow,
    state: State<'_, Arc<StateManager>>,
    player: State<'_, UnityPlayer>,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::{os::windows::process::CommandExt, process::Command};
        use tauri::Manager;

        let executable = window
            .path()
            .app_local_data_dir()
            .map_err(|_| UNAVAILABLE)?
            .join("unity-player/OpenFootMatch.exe");
        if !executable.is_file() {
            return Ok(false);
        }
        let mut current = player.0.lock().map_err(|_| UNAVAILABLE)?;
        if current.is_some() {
            return Err(UNAVAILABLE.into());
        }
        let request = PathBuf::from(super::unity_match::export_request(&state)?);
        let result = request.with_extension("").with_extension("result.json");
        if result.is_file() {
            return Ok(true);
        }
        let bounds = result.with_extension("bounds.json");
        let _ = std::fs::remove_file(bounds.with_extension("attached"));
        let hwnd = window.hwnd().map_err(|_| UNAVAILABLE)?.0 as usize;
        let tactics = TacticsChannel::new().map_err(|_| UNAVAILABLE)?;
        let child = Command::new(&executable)
            .current_dir(executable.parent().ok_or(UNAVAILABLE)?)
            .arg("-openfoot-request")
            .arg(request)
            .arg("-openfoot-bounds")
            .arg(&bounds)
            .arg("-openfoot-tactics")
            .arg(tactics.directory.path())
            .args(["-parentHWND", &hwnd.to_string(), "-screen-fullscreen", "0"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|error| {
                log::error!("Unable to start Unity player: {error}");
                UNAVAILABLE
            })?;
        *current = Some(EmbeddedMatch {
            child,
            result,
            bounds,
            last_bounds: None,
            started: Instant::now(),
            tactics,
        });
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, state, player);
        Ok(false)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct PlayerBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[tauri::command]
pub fn update_unity_player(
    state: State<'_, Arc<StateManager>>,
    player: State<'_, UnityPlayer>,
    bounds: PlayerBounds,
) -> Result<UnityPlayerUpdate, String> {
    let mut current = player.0.lock().map_err(|_| UNAVAILABLE)?;
    let Some(match_player) = current.as_mut() else {
        return Ok(UnityPlayerUpdate {
            finished: super::unity_match::result_available(&state)?,
            ..Default::default()
        });
    };
    if match_player.result.is_file() {
        return Ok(UnityPlayerUpdate {
            finished: true,
            ..Default::default()
        });
    }
    if match_player
        .child
        .try_wait()
        .map_err(|_| UNAVAILABLE)?
        .is_some()
    {
        *current = None;
        return Err(UNAVAILABLE.into());
    }
    if match_player.last_bounds != Some(bounds) {
        let bytes = serde_json::to_vec(&bounds).map_err(|_| UNAVAILABLE)?;
        std::fs::write(&match_player.bounds, bytes).map_err(|_| UNAVAILABLE)?;
        match_player.last_bounds = Some(bounds);
    }
    if match_player.started.elapsed().as_secs() > 45
        && !match_player.bounds.with_extension("attached").is_file()
    {
        *current = None;
        return Err(UNAVAILABLE.into());
    }

    Ok(UnityPlayerUpdate {
        finished: false,
        tactics: Some(match_player.tactics.status()),
    })
}

#[tauri::command]
pub fn set_unity_play_style(
    player: State<'_, UnityPlayer>,
    play_style: PlayStyle,
) -> Result<TacticsStatus, String> {
    let mut current = player.0.lock().map_err(|_| TACTIC_FAILED)?;
    let match_player = current.as_mut().ok_or(TACTIC_FAILED)?;
    if match_player.result.is_file()
        || match_player
            .child
            .try_wait()
            .map_err(|_| TACTIC_FAILED)?
            .is_some()
    {
        return Err(TACTIC_FAILED.into());
    }
    match_player.tactics.send(play_style)
}

#[tauri::command]
pub fn stop_unity_player(player: State<'_, UnityPlayer>) -> Result<(), String> {
    player.0.lock().map_err(|_| UNAVAILABLE)?.take();
    Ok(())
}

#[tauri::command]
pub fn substitute_unity_player(
    state: State<'_, Arc<StateManager>>,
    player: State<'_, UnityPlayer>,
    player_off_id: String,
    player_on_id: String,
) -> Result<TacticsStatus, String> {
    let mut current = player.0.lock().map_err(|_| SUB_FAILED)?;
    let match_player = current.as_mut().ok_or(SUB_FAILED)?;
    if match_player.result.is_file()
        || match_player
            .child
            .try_wait()
            .map_err(|_| SUB_FAILED)?
            .is_some()
    {
        return Err(SUB_FAILED.into());
    }
    let confirmed = match_player.tactics.status().substitutions;
    let order = UnitySubstitution {
        minute: 0,
        player_off_id,
        player_on_id,
    };
    let save_id = state.get_save_id();
    let legal = state
        .with_live_match(|live| {
            let snapshot = live.snapshot();
            let id = live.external_match_id(save_id.as_deref(), &snapshot);
            // The running player must belong to the current fixture.
            if match_player
                .result
                .file_name()
                .and_then(|name| name.to_str())
                != Some(&format!("{id}.result.json"))
            {
                return None;
            }
            let mut lineup = UnityLineup::new(&snapshot, live.user_side?);
            for change in &confirmed {
                lineup.substitute(change)?;
            }
            lineup.substitute(&order)
        })
        .flatten();
    if legal.is_none() {
        return Err(SUB_FAILED.into());
    }
    match_player
        .tactics
        .send_order(LiveOrder::Substitution(order), SUB_FAILED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unity_tactics_applies_only_the_confirmation_for_the_pending_order() {
        let mut channel = TacticsChannel::new().unwrap();
        assert!(channel.send(PlayStyle::HighPress).is_err());
        let dir = channel.directory.path().to_path_buf();
        std::fs::write(dir.join("ready"), "").unwrap();
        assert!(channel.send(PlayStyle::Possession).is_err());
        assert!(channel.send(PlayStyle::HighPress).unwrap().pending);
        assert!(channel.send(PlayStyle::Defensive).is_err());
        let ack = dir.join("1.applied.json");
        std::fs::write(&ack, r#"{"play_style":"Defensive","minute":42}"#).unwrap();
        assert!(channel.status().pending);
        std::fs::write(&ack, r#"{"play_style":"HighPress","minute":42}"#).unwrap();
        let status = channel.status();
        assert!(!status.pending);
        assert_eq!(status.applied.unwrap().minute, 42);
        assert!(channel.send(PlayStyle::Defensive).unwrap().pending);
        assert!(dir.join("2.order.json").is_file());
    }

    #[test]
    fn unity_substitution_waits_for_a_matching_player_confirmation() {
        let mut channel = TacticsChannel::new().unwrap();
        let dir = channel.directory.path().to_path_buf();
        let change = UnitySubstitution {
            minute: 0,
            player_off_id: "starter".into(),
            player_on_id: "reserve".into(),
        };
        let order = LiveOrder::Substitution(change.clone());
        std::fs::write(dir.join("ready"), "").unwrap();
        assert!(channel.send_order(order.clone(), SUB_FAILED).is_err());
        std::fs::write(dir.join("ready"), "substitutions").unwrap();
        assert!(
            channel
                .send_order(order, SUB_FAILED)
                .unwrap()
                .pending_substitution
        );

        let ack = dir.join("1.applied.json");
        std::fs::write(
            &ack,
            r#"{"player_off_id":"starter","player_on_id":"other","minute":52}"#,
        )
        .unwrap();
        assert!(channel.status().pending);
        let applied = UnitySubstitution {
            minute: 52,
            ..change
        };
        std::fs::write(ack, serde_json::to_vec(&applied).unwrap()).unwrap();
        let status = channel.status();
        assert!(!status.pending);
        assert_eq!(status.substitutions, vec![applied]);
    }

    #[test]
    fn unity_panel_marker_keeps_the_manager_control_hidden() {
        let mut channel = TacticsChannel::new().unwrap();
        let dir = channel.directory.path().to_path_buf();
        std::fs::write(dir.join("ready"), "panel").unwrap();
        let status = channel.status();
        assert!(status.ready);
        assert!(status.substitutions_ready);
        assert!(status.substitutions_panel);

        let order = LiveOrder::Substitution(UnitySubstitution {
            minute: 0,
            player_off_id: "starter".into(),
            player_on_id: "reserve".into(),
        });
        assert!(channel.send_order(order, SUB_FAILED).is_ok());
        assert!(channel.status().pending_substitution);
    }
}
