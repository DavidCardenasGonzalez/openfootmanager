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

The request supplies team identities, eleven starters per side, a supported formation and player attributes. The managed team also receives its bench and the match substitution limit. The keeper occupies slot zero. The adapter clones the template teams for kits and appearance. Player order determines formation slots. The result supplies the final score, starting rosters, attributed goals and completed substitutions. Older score-only results are accepted. Own goals count toward the final score.

For single-match knockout fixtures, a tie at 90 minutes starts two extra periods of 15 minutes. A tie at 120 starts an on-pitch shootout with alternating kicks, early decisions and sudden death. The player uses each team's assigned goal to preserve the simulator's keeper behaviour. The shootout is recorded separately from the score and the match statistics. OpenFoot uses its existing competition rules to advance the winner.

The managed side optionally carries `play_style` and a `tactics` blueprint. Unity applies them before kickoff and leaves the opponent under simulator AI. Balanced, Attacking, Defensive, Counter and HighPress use the corresponding simulator presets. Possession adds nearby support and prefers short buildup when buildup is set to Mixed. The Football Simulator 1.1a adapter installs its passive UserManager in the managed team’s private tacticManager field at initialization. Recheck this binding when updating the asset.

During an embedded Windows match, OpenFoot enables the style selector at kickoff. It sends one order at a time and shows the new style and minute after Unity confirms. The standalone player uses a fresh temporary directory for each launch, with numbered order and confirmation files. Rebuild the standalone player to enable this control.

The substitution controls queue a change until a restart. The replacement takes the outgoing player's formation slot, with their own shirt number, name and attributes. Goalkeepers replace goalkeepers. The bridge validates goals against the minutes each player was eligible to play, and OpenFoot stores confirmed substitutions with the match report.

## Full-time statistics in OpenFoot

New Unity builds send the full-time counters for possession, shots, shots on target, passes, corners and saves. Player rows use OpenFoot IDs for starters and substitutes who entered. OpenFoot adds their club side, name and minutes played from the fixture lineup and confirmed substitutions.

The round summary displays the observed stats for your match. Open **Stats** on the completed fixture in **Schedule** to see the saved report again. Passes are shown as completed over attempted. Statistics use the simulator's own counters. Older Unity results can still be imported without the optional statistics block.

## Referee and restarts in observed matches

Run `node scripts/install-unity-rules.mjs "<Unity project path>"` after installing Football Simulator 1.1a and the OpenFoot bridge. The script adds the rule hooks to the local asset and preserves the original scripts under `%LOCALAPPDATA%/OpenFootUnityBackups`. Sync the bridge scripts and the `OpenFootRoleLabels` resource before rebuilding the Windows player.

The referee judges close slide tackles. Failed tackles and tackles from behind carry more risk. The position of the contact determines the restart. Offside is called when a flagged player actually touches the ball, with the simulator's exemption for a direct throw-in, goal kick or corner. Discipline removes a dismissed player from the active lineup and keeps their appearance in the report. A penalty uses the regular shot animation, keeper and ball physics. The match panel keeps the current formation after a dismissal, and substitutions can still replace players who remain on the pitch.

The Unity HUD briefly shows referee decisions. The saved report lists fouls, cards, offsides, throw-ins and penalty outcomes under **Key Events**. Rust still resolves matches that are not observed.

## Condition during 3D matches

OpenFoot sends condition, fitness and stamina for starters and the managed bench. Only players on the field accumulate wear as the match clock advances. Movement increases that wear, while goalkeepers use a lower rate. Lower condition reduces native acceleration, speed, agility, passing, shooting and tackling. A player's ring appears below 75% condition and switches from yellow to red below 50%.

Substitutes begin with their own condition. The Unity result carries the ending condition for each player who featured. OpenFoot uses the observed loss once, along with the existing fitness update. Older results still use the minutes-based calculation.

## Substitutions inside the match

The managed side gets an in-match panel when the bridge ships with `OpenFootSubstitutionPanel.cs` and a bench. The HUD button sits bottom right, next to the pitch, and shows the remaining changes. Opening it lists the eleven players on the pitch and the available substitutes; the scoreboard stays visible and the panel closes with its X. The panel builds its own overlay canvas, so the licensed `MatchUI` prefab is never edited, and it uses TextMeshPro like the scoreboard.

Select the player who leaves, then the replacement. Keepers only accept keepers, duplicates are refused and the limit comes from `max_subs`. Confirming shows the change as pending until the match reaches a legal restart; the panel then applies it, shows the minute and refreshes both lists. `OpenFootBridge.CheckSubstitution` and `TrySubstitute` are the single validation and execution path shared with the order files that `OpenFootStandalone.LiveTactics` polls. The simulation lineup is the source of truth: a confirmed change replaces the outgoing player in both lists, so a second selection works from the updated squad.

While the panel is installed the standalone player writes `panel` instead of `substitutions` to the tactic channel's `ready` file. The manager exposes that as `substitutions_panel` and hides its own substitute selects and play-style selector, keeping one visible control for each.

The same panel carries the play-style selector: Balanced, Attacking, Defensive, Counter and High Press. The status line shows the style applied at kickoff with minute 0, then the pending order while Unity acknowledges it, and finally the style and minute it was applied. `OpenFootBridge.TryChangeStyle` reuses the manager's `ChangeStyle` path, refuses to repeat the active style and the panel refuses a style order while a substitution is pending. Because the bridge applies the preset through `TeamChangedTactic`, the simulation changes without restarting the match. The style names and labels mirror the manager's `common.playStyles` translations.

Labels ship in the twelve manager languages and follow the Unity system language, falling back to English. The prefab is generated from the same builder with **OpenFoot → Rebuild substitution prefab**; the runtime builds the hierarchy from code if the prefab is missing or its script references are broken.

Open **Formation** in the match panel to choose from the twelve formations supported by the match bridge. The right column previews the closest assignment of the eleven current players and the effective role at each position. Select two outfield players in the preview to swap their assignments. This also works when rearranging players within the current formation.

Confirm to queue that exact lineup for the next restart after its tactical data is ready. The goalkeeper stays in goal. Players keep their identities, AI archetypes and statistics. The tactical blueprint and play style carry across the change, and incompatible individual roles use Standard while the player occupies that slot. The panel shows the minute when the formation takes effect.

Choose **Player Roles** in the match panel and select an active player to see the roles supported in their current formation slot. Changes on the manager's prematch screen reach the kickoff lineup. In-match orders apply to that player for the observed match. A player uses Standard while in an incompatible slot and resumes their selected role in a compatible slot. The [role matrix](../../docs/UNITY_PLAYER_INSTRUCTIONS.md) specifies the effects and how to verify them. Regenerate the localized resource with `node scripts/sync-unity-role-labels.mjs` when the manager's role labels change.

## Team tactics

**Phase blueprint** in the match panel shows all nine settings. Click a setting to cycle its values. The panel shows the confirmed value and minute. Live changes apply to this match. Edits on the manager's preview update the saved blueprint and reach Unity when the match starts.

| Setting | Effect in Unity |
| --- | --- |
| Buildup style | Short prefers an open pass within 22 m. Long prefers an aerial ball that advances play. Mixed uses the style's default. |
| Width | Spreads or narrows the attacking shape. |
| Tempo | Patient keeps the attack closer and prefers short support passes. Direct uses the chosen preset's progression. |
| Defensive line | Moves the defensive block higher or deeper. |
| Pressing | Changes how many nearby players can challenge the opposing ball carrier. |
| Defensive shape | Compresses or spreads the defensive block. |
| Marking | Varies how strongly defenders follow the opponent assigned by the simulator. |
| Counter-press | Adds pressure for five or ten simulation seconds after a confirmed turnover. |
| Break speed | Varies how strongly players join the attack for five simulation seconds after a regain. Fast also looks for a viable forward pass. |

Collective shape is applied to the formation preset before individual positioning rules. Individual ball decisions and set pieces keep priority, and the simulator checks passing lanes and offside. The values are initial calibration settings.

## Verification

- `node --test scripts/unity-bridge.test.mjs` runs the standalone JSON converter checks.
- **OpenFoot → Rebuild substitution prefab** regenerates `Assets/OpenFootBridge/Resources/OpenFootSubstitutionPanel.prefab`; keep the copy in `integrations/unity/Resources/` in sync.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib unity_ticket` checks result validation and repeat application.
- `npx vitest run src/pages/MatchSimulation.test.tsx src/i18n/localeCoverage.test.ts` checks the manager UI and translations.
- With the licensed editor available, run `cargo test --manifest-path src-tauri/Cargo.toml --lib unity_editor_roundtrip -- --ignored --nocapture` and open the printed request in the Unity menu. The test waits for full time, applies the result, reloads an isolated SQLite save, and checks both fixtures and standings.

The commercial simulator and its assets stay in the licensed Unity project.
