# OpenFoot Manager and Football Simulator

OpenFoot Manager owns the career, fixtures, standings and save. Unity renders and simulates the observed league match. For the other scheduled league matches, Rust simulates each minute internally.

## Play inside OpenFoot Manager on Windows

1. Copy the C# files in this directory to `Assets/OpenFootBridge/` in the licensed Football Simulator project. Copy the contents of `Editor/` and `Resources/` into the matching subfolders.
2. In Unity 2022.3.46f1, use **OpenFoot → Build Windows player**. Keep the generated executable and its companion files in `%LOCALAPPDATA%/com.sturdyrobot.openfootmanager/unity-player/`.
3. Select **Unity 3D** in the manager's prematch screen. The player opens inside the match view and the manager imports the final score automatically. The editor workflow below is available if the player is missing or fails to open.

## Play in Unity Editor

1. Use the same bridge scripts and resources described above, including `Editor/OpenFootMatchRunner.cs`. The tested editor is Unity 2022.3.46f1.
2. Launch OpenFoot Manager with `npm run tauri dev`. Open your team's prematch screen and select **Unity 3D**. Keep the manager open.
3. In Unity Editor, choose **OpenFoot → Play manager match** and select the indicated `.request.json` file. The editor opens the template's starting scene and starts an AI versus AI match.
4. After the final whistle, return to the manager and select **Apply result**. The manager checks the active career, session, scheduled fixture and ordered starters, updates the round and attempts to save. If saving fails, retry from the dashboard.

The processes exchange version 1 JSON files in the system temporary directory under `OpenFootMatchBridge`. The editor publishes the `.result.json` file once the complete result is written. Importing before full time leaves the session available for retry. Restarting the manager requires starting the fixture again.

## Scope

The request supplies team identities, eleven starters per side, a supported formation and player attributes. The managed team also receives its bench and the match substitution limit. The keeper occupies slot zero. The adapter clones the template teams for kits and appearance. Player order determines formation slots. The result supplies the final score, starting rosters, attributed goals and completed substitutions. Older score-only results are accepted. Own goals count toward the final score. The template exposes no assist or card events. Knockout matches use the existing manager flow.

The managed side optionally carries `play_style`. Unity applies it before kickoff and leaves the opponent under simulator AI. Balanced, Attacking, Defensive, Counter and HighPress use the corresponding simulator presets. Possession uses Balanced because the simulator has no possession preset. Legacy requests omit the field and retain autonomous coaches on both sides. The Football Simulator 1.1a adapter installs its passive UserManager in the managed team’s private tacticManager field at initialization. Recheck this binding when updating the asset.

During an embedded Windows match, OpenFoot enables the style selector at kickoff. It sends one order at a time and shows the new style and minute after Unity confirms. The standalone player uses a fresh temporary directory for each launch, with numbered order and confirmation files. Rebuild the standalone player to enable this control.

The substitution controls queue a change until a restart. The replacement takes the outgoing player's formation slot, with their own shirt number, name and attributes. Goalkeepers replace goalkeepers. The bridge validates goals against the minutes each player was eligible to play, and OpenFoot stores confirmed substitutions with the match report.

## Substitutions inside the match

The managed side gets an in-match panel when the bridge ships with `OpenFootSubstitutionPanel.cs` and a bench. The HUD button sits bottom right, next to the pitch, and shows the remaining changes. Opening it lists the eleven players on the pitch and the available substitutes; the scoreboard stays visible and the panel closes with its X. The panel builds its own overlay canvas, so the licensed `MatchUI` prefab is never edited, and it uses TextMeshPro like the scoreboard.

Select the player who leaves, then the replacement. Keepers only accept keepers, duplicates are refused and the limit comes from `max_subs`. Confirming shows the change as pending until the match reaches a legal restart; the panel then applies it, shows the minute and refreshes both lists. `OpenFootBridge.CheckSubstitution` and `TrySubstitute` are the single validation and execution path shared with the order files that `OpenFootStandalone.LiveTactics` polls. The simulation lineup is the source of truth: a confirmed change replaces the outgoing player in both lists, so a second selection works from the updated squad.

While the panel is installed the standalone player writes `panel` instead of `substitutions` to the tactic channel's `ready` file. The manager exposes that as `substitutions_panel` and hides its own substitute selects and play-style selector, keeping one visible control for each.

The same panel carries the play-style selector: Balanced, Attacking, Defensive, Counter and High Press. The status line shows the style applied at kickoff with minute 0, then the pending order while Unity acknowledges it, and finally the style and minute it was applied. `OpenFootBridge.TryChangeStyle` reuses the manager's `ChangeStyle` path, refuses to repeat the active style and the panel refuses a style order while a substitution is pending. Because the bridge applies the preset through `TeamChangedTactic`, the simulation changes without restarting the match. The style names and labels mirror the manager's `common.playStyles` translations.

Labels ship in the twelve manager languages and follow the Unity system language, falling back to English. The prefab is generated from the same builder with **OpenFoot → Rebuild substitution prefab**; the runtime builds the hierarchy from code if the prefab is missing or its script references are broken.

The in-match panel can also queue a change to **4-4-2** or **4-3-3**. At the next restart after Unity has loaded the formation's tactics, it reassigns the eleven players on the pitch to the closest available positions and keeps the goalkeeper in goal. The panel shows the confirmed minute and current positions. Players keep their identities, existing AI archetypes and accumulated stats. Formation changes affect the current Unity match, while the existing report continues to record the result, goals and substitutions.

Choose **Player Roles** in the match panel and select an active player to see the roles supported in their current formation slot. Changes on the manager's prematch screen reach the kickoff lineup. In-match orders apply to that player for the observed match. A player uses Standard while in an incompatible slot and resumes their selected role in a compatible slot. The [role matrix](../../docs/UNITY_PLAYER_INSTRUCTIONS.md) specifies the effects and how to verify them. Regenerate the localized resource with `node scripts/sync-unity-role-labels.mjs` when the manager's role labels change.

## Verification

- `node --test scripts/unity-bridge.test.mjs` runs the standalone JSON converter checks.
- **OpenFoot → Rebuild substitution prefab** regenerates `Assets/OpenFootBridge/Resources/OpenFootSubstitutionPanel.prefab`; keep the copy in `integrations/unity/Resources/` in sync.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib unity_ticket` checks result validation and repeat application.
- `npx vitest run src/pages/MatchSimulation.test.tsx src/i18n/localeCoverage.test.ts` checks the manager UI and translations.
- With the licensed editor available, run `cargo test --manifest-path src-tauri/Cargo.toml --lib unity_editor_roundtrip -- --ignored --nocapture` and open the printed request in the Unity menu. The test waits for full time, applies the result, reloads an isolated SQLite save, and checks both fixtures and standings.

The commercial simulator and its assets stay in the licensed Unity project.
