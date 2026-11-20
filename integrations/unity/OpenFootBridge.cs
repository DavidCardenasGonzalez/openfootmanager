using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using FStudio.MatchEngine.AIManager;
using FStudio.MatchEngine.Balls;
using FStudio.MatchEngine.Enums;
using FStudio.MatchEngine.Statistics;
using FStudio.MatchEngine.FieldPositions;
using FStudio.MatchEngine.Tactics;
using System.Threading.Tasks;
using UnityEngine;
using FStudio;
using FStudio.Database;
using FStudio.Data;
using FStudio.Events;
using FStudio.MatchEngine;
using FStudio.MatchEngine.Events;
using FStudio.MatchEngine.Players;
using FStudio.UI;
using FStudio.UI.Events;
using FStudio.UI.GamepadInput;
using FStudio.UI.MatchThemes;
using FStudio.UI.MatchThemes.MatchEvents;
using Shared.Responses;

// Install under Assets/OpenFootBridge. Independent from the vendor sources.
public sealed class OpenFootBridge : MonoBehaviour
{
    [Serializable] public class Player { public string id, name, position, role; public int pace, passing, shooting, tackling, dribbling, strength, positioning, agility, reflexes; }
    [Serializable] public class Team { public string id, name, formation, play_style; public Player[] players, bench; }
    [Serializable] public class Request { public int version, max_subs; public string request_id; public Team home, away; }
    [Serializable] public class Result { public int version=1; public string request_id, status="finished", home_id, away_id; public int home_goals, away_goals; public string[] player_ids; public Goal[] goals; public Substitution[] substitutions; }
    [Serializable] public class Goal { public int minute; public string side, player_id; }
    [Serializable] public class Substitution { public int minute; public string player_off_id, player_on_id; }

    // Read-only snapshot for the in-match panel. Both the Unity panel and the
    // standalone order queue read the same lists and use the same validation.
    public sealed class LineupPlayer
    {
        public string Id, Name, Position, Role;
        public Positions Slot;
        public int Number;
        public bool Keeper;
    }

    private readonly Dictionary<PlayerEntry, string> playerIds = new Dictionary<PlayerEntry, string>();
    private readonly Dictionary<string, string> positions = new Dictionary<string, string>();
    private readonly Dictionary<string, string> playerRoles = new Dictionary<string, string>();
    private readonly List<Goal> goals = new List<Goal>();
    private readonly List<Substitution> substitutions = new List<Substitution>();
    private readonly List<LineupPlayer> lineup = new List<LineupPlayer>();
    private readonly List<LineupPlayer> substitutes = new List<LineupPlayer>();
    private readonly Dictionary<string, (PlayerEntry entry, int number, bool keeper)> bench =
        new Dictionary<string, (PlayerEntry, int, bool)>();
    private TeamEntry homeTeam, awayTeam;
    private Request active;
    private GameTeam managedTeam;
    private bool kickedOff;
    private Formations requestedFormation;
    private Task<TeamTactics> formationTactics;
    public string ResultJson { get; private set; }
    public bool Loading { get; private set; }
    public string LastError { get; private set; }

    private void OnEnable()
    {
        EventManager.Subscribe<MatchInitializationCompletedEvent>(OnTeamsReady);
        EventManager.Subscribe<FirstWhistleEvent>(OnFirstWhistle);
        EventManager.Subscribe<GoalScoredEvent>(OnGoal);
        EventManager.Subscribe<FinalWhistleEvent>(OnFinished);
    }

    private void OnDisable()
    {
        EventManager.UnSubscribe<MatchInitializationCompletedEvent>(OnTeamsReady);
        EventManager.UnSubscribe<FirstWhistleEvent>(OnFirstWhistle);
        EventManager.UnSubscribe<GoalScoredEvent>(OnGoal);
        EventManager.UnSubscribe<FinalWhistleEvent>(OnFinished);
    }

    public async Task Begin(string json)
    {
        if(active!=null || Loading) throw new InvalidOperationException("Bridge already has a match");
        var request=JsonUtility.FromJson<Request>(json);
        if(request==null || request.version!=1 || string.IsNullOrEmpty(request.request_id)) throw new ArgumentException("Invalid bridge request");
        Validate(request.home); Validate(request.away);
        if (!string.IsNullOrEmpty(request.home.play_style) && !string.IsNullOrEmpty(request.away.play_style))
            throw new ArgumentException("Only one team can be controlled by OpenFoot");
        if(request.home.id==request.away.id || request.home.players.Concat(request.away.players).Select(p=>p.id).Distinct().Count()!=22) throw new ArgumentException("Duplicate identities");
        var templates=DatabaseService.LoadTeams();
        if(templates.Length<2) throw new InvalidOperationException("Template teams are missing");
        Loading=true; LastError=null; ResultJson=null;
        try {
            playerIds.Clear();
            positions.Clear();
            playerRoles.Clear();
            goals.Clear();
            substitutions.Clear();
            lineup.Clear();
            substitutes.Clear();
            bench.Clear();
            var match = new MatchCreateRequest(
                ConvertTeam(request.home, templates[0]),
                ConvertTeam(request.away, templates[1]));
            // MatchCreateRequest clones each team and its players.
            homeTeam = match.homeTeam;
            awayTeam = match.awayTeam;
            for (int slot = 0; slot < 11; slot++)
            {
                playerIds.Add(homeTeam.Players[slot], request.home.players[slot].id);
                playerIds.Add(awayTeam.Players[slot], request.away.players[slot].id);
            }
            var managed = !string.IsNullOrEmpty(request.home.play_style) ? request.home : request.away;
            foreach (var starter in managed.players)
                if (!string.IsNullOrEmpty(starter.role)) playerRoles[starter.id] = starter.role;
            var reserves = !string.IsNullOrEmpty(request.home.play_style) ? request.home.bench : request.away.bench;
            var reserveTeam = !string.IsNullOrEmpty(request.home.play_style) ? homeTeam : awayTeam;
            if (reserves != null && request.max_subs > 0)
            {
                int id = playerIds.Keys.Max(p => p.id) + 1;
                for (int index = 0; index < reserves.Length; index++)
                {
                    var data = reserves[index];
                    ValidatePlayer(data);
                    if (playerIds.ContainsValue(data.id) || bench.ContainsKey(data.id))
                        throw new ArgumentException("Duplicate reserve identity");
                    var entry = reserveTeam.Players[index % 11].Clone(reserveTeam);
                    entry.id = id++;
                    SetAttributes(entry, data);
                    bench.Add(data.id, (entry, index + 12, data.position == "Goalkeeper"));
                    positions[data.id] = data.position;
                }
            }
            active=request;
            await StartObservedMatch(match);
        } catch(Exception error) { active=null; LastError=error.ToString(); throw; }
        finally { Loading=false; }
    }

    private static async Task StartObservedMatch(MatchCreateRequest match)
    {
        EventManager.Trigger(new CloseAllPanelsEvent());
        SnapManager.Clear();

        var ui = UILoader.Current;
        await ui.MatchUILoader.Load();
        ui.GeneralUILoader.Unload();

        // The manager has already shown the lineups. The template's preview
        // loads asynchronously and can otherwise reopen over the live pitch.
        var lineup = ui.MatchUILoader.CurrentInstantiated.GetComponentInChildren<UpcomingMatchPanel>(true);
        if (lineup != null)
            lineup.gameObject.SetActive(false);

        var upcoming = new UpcomingMatchEvent(match);
        EventManager.Trigger(upcoming);
        await MatchEngineLoader.Current.StartMatchEngine(upcoming, false, true);
    }
    private static void Validate(Team team) {
        Formations formation;
        if(team==null || string.IsNullOrEmpty(team.id) || team.players==null || team.players.Length!=11 || !Enum.TryParse(team.formation,out formation) || formation==Formations.ParametersCount) throw new ArgumentException("Invalid team");
        foreach (var player in team.players) ValidatePlayer(player);
    }
    private static void ValidatePlayer(Player p)
    {
        if (p == null || string.IsNullOrEmpty(p.id)) throw new ArgumentException("Missing player");
        foreach (var n in new[] { p.pace, p.passing, p.shooting, p.tackling, p.dribbling, p.strength, p.positioning, p.agility, p.reflexes })
            if (n < 0 || n > 100) throw new ArgumentException("Invalid attribute");
    }

    private static TeamEntry ConvertTeam(Team input,TeamEntry template) {
        var team=(TeamEntry)template.Clone(); team.TeamName=input.name; team.Formation=(Formations)Enum.Parse(typeof(Formations),input.formation);
        for (int i = 0; i < 11; i++) SetAttributes(team.Players[i], input.players[i]);
        return team;
    }

    private static void SetAttributes(PlayerEntry to, Player from)
    {
            to.Name = to.name = from.name;
            to.topSpeed=to.acceleration=from.pace; to.passing=to.longBall=from.passing;
            to.shooting=to.shootPower=from.shooting; to.tackling=from.tackling;
            to.ballControl=to.ballKeeping=to.dribbleSpeed=from.dribbling;
            to.strength=from.strength; to.positioning=from.positioning;
            to.agility=from.agility; to.reaction=from.reflexes;
    }

    private static TacticPresetTypes Preset(string style)
    {
        switch (style)
        {
            case "Balanced":
            case "Possession": return TacticPresetTypes.Balanced;
            case "Attacking": return TacticPresetTypes.Offensive;
            case "Defensive": return TacticPresetTypes.Defensive;
            case "Counter": return TacticPresetTypes.CounterAttack;
            case "HighPress": return TacticPresetTypes.HighPressure;
            default: throw new ArgumentException("Unknown OpenFoot play style: " + style);
        }
    }

    private void OnTeamsReady(MatchInitializationCompletedEvent evt)
    {
        if (active == null) return;
        var match = MatchManager.Current;
        bool managesHome = !string.IsNullOrEmpty(active.home.play_style);
        var input = managesHome ? active.home : active.away;
        if (string.IsNullOrEmpty(input.play_style)) return;
        managedTeam = managesHome ? match.GameTeam1 : match.GameTeam2;
        PrepareManagedTeam(managedTeam);
        if (bench.Count > 0)
        {
            // Install the reserves before any statistics are collected. FStudio indexes
            // match statistics by numeric player ID, including the incoming player.
            var setter = typeof(MatchManager).GetProperty(nameof(MatchManager.Statistics)).GetSetMethod(true);
            if (setter == null) throw new MissingMethodException("MatchManager.Statistics");
            var ids = playerIds.Keys.Select(p => p.id).Concat(bench.Values.Select(p => p.entry.id)).ToArray();
            MatchManager.Statistics.Dispose();
            setter.Invoke(null, new object[] { new StatisticsManager(ids, Ball.Current) });
        }
        SetPreset(managedTeam, Preset(input.play_style));
        OpenFootPlayerRoles.BindTeam(managedTeam.GamePlayers, RoleFor);
        ActivePlayStyle = input.play_style == "Possession" ? "Balanced" : input.play_style;
        StyleMinute = 0;
        StyleVersion++;
        BuildLineup();
        InstallSubstitutionPanel();
        Debug.Log($"[OpenFoot] Applied {input.play_style} to {input.id} before kickoff.");
    }

    /// <summary>
    /// Installs the in-match panel when it is included in the Unity project.
    /// </summary>
    private void InstallSubstitutionPanel()
    {
        if (SubstitutionPanelAvailable) return;
        var type = Type.GetType("OpenFootSubstitutionPanel");
        var install = type?.GetMethod("Install", BindingFlags.Public | BindingFlags.Static);
        if (install == null)
        {
            Debug.Log("[OpenFoot] Substitution panel not installed: OpenFootSubstitutionPanel.cs is missing.");
            return;
        }
        install.Invoke(null, new object[] { this });
    }

    private static void PrepareManagedTeam(GameTeam team)
    {
        // Football Simulator 1.1a exposes the tactic, but not its manager setter.
        // Use its passive UserManager so outfield players still play autonomously.
        var field = typeof(GameTeam).GetField("tacticManager", BindingFlags.Instance | BindingFlags.NonPublic);
        if (field == null) throw new MissingFieldException(typeof(GameTeam).FullName, "tacticManager");
        field.SetValue(team, new UserManager());
    }

    private static void SetPreset(GameTeam team, TacticPresetTypes preset)
    {
        team.Team.TacticPresetType = preset;
        EventManager.Trigger(new TeamChangedTactic(team, preset));
    }

    private void OnFirstWhistle(FirstWhistleEvent evt)
    {
        if (active != null) kickedOff = true;
    }

    public bool CanChangeStyle => kickedOff && managedTeam != null && ResultJson == null;
    public bool HasSubstitutes => bench.Count > 0;

    /// <summary>True once the in-match substitution panel finished installing.</summary>
    public bool SubstitutionPanelAvailable { get; private set; }
    public IReadOnlyList<LineupPlayer> Lineup => lineup;
    public IReadOnlyList<LineupPlayer> Substitutes => substitutes;
    public int SubstitutionsUsed => substitutions.Count;
    public int SubstitutionLimit => active == null ? 0 : active.max_subs;
    public int SubstitutionsRemaining => Mathf.Max(0, SubstitutionLimit - substitutions.Count);
    public int LineupVersion { get; private set; }

    /// <summary>Effective style applied to the managed side and the minute it changed.</summary>
    public string ActivePlayStyle { get; private set; }
    public int StyleMinute { get; private set; }
    public int StyleVersion { get; private set; }

    public string RoleFor(PlayerBase player) =>
        playerIds.TryGetValue(player.MatchPlayer.Player, out var id) && playerRoles.TryGetValue(id, out var role)
            ? OpenFootPlayerRoles.Effective(player.MatchPlayer.Position, role)
            : OpenFootPlayerRoles.Standard;

    public bool TrySetPlayerRole(string playerId, string role)
    {
        if (!CanChangeStyle || FormationPending || string.IsNullOrEmpty(playerId) || string.IsNullOrEmpty(role))
            return false;
        var player = Array.Find(managedTeam.GamePlayers, candidate =>
            playerIds.TryGetValue(candidate.MatchPlayer.Player, out var id) && id == playerId);
        if (player == null || !OpenFootPlayerRoles.ForPosition(player.MatchPlayer.Position).Contains(role))
            return false;

        playerRoles[playerId] = role;
        // Let any forced restart finish. Otherwise the new preference can run
        // on the next AI decision without waiting for a previous run to expire.
        if (player.ActiveBehaviour?.ForceBehaviour != true)
        {
            player.ActiveBehaviour = null;
            player.NextBehaviour = 0f;
        }
        BuildLineup();
        return true;
    }

    public string ActiveFormation => managedTeam == null ? "" : FormationName(managedTeam.Team.Formation);
    public bool FormationPending => formationTactics != null;
    public string PendingFormation => FormationPending ? FormationName(requestedFormation) : "";
    public int FormationMinute { get; private set; }
    public int FormationVersion { get; private set; }
    public bool FormationFailed { get; private set; }

    private static string FormationName(Formations formation) =>
        formation.ToString().TrimStart('_').Replace('_', '-');

    public bool TryQueueFormation(string formation)
    {
        if (!CanChangeStyle || FormationPending) return false;
        Formations target;
        switch (formation)
        {
            case "4-4-2": target = Formations._4_4_2; break;
            case "4-3-3": target = Formations._4_3_3; break;
            default: return false;
        }
        if (target == managedTeam.Team.Formation) return false;
        requestedFormation = target;
        FormationFailed = false;
        formationTactics = PlayableFormations.Current.Formations.FindAsync(target);
        FormationVersion++;
        return true;
    }

    private void Update()
    {
        if (formationTactics == null || !formationTactics.IsCompleted) return;
        if (ResultJson != null)
        {
            formationTactics = null;
            return;
        }
        if (!CanSubstitute) return;
        try
        {
            var tactics = formationTactics.GetAwaiter().GetResult();
            if (tactics == null) throw new InvalidOperationException("Formation has no tactical data");
            ApplyFormation(requestedFormation, tactics);
            FormationMinute = Mathf.Clamp(Mathf.CeilToInt(MatchManager.Current.minutes), 1, 90);
        }
        catch (Exception error)
        {
            FormationFailed = true;
            Debug.LogException(error);
        }
        finally
        {
            formationTactics = null;
            FormationVersion++;
        }
    }

    private void ApplyFormation(Formations formation, TeamTactics tactics)
    {
        var players = managedTeam.GamePlayers;
        var slots = FormationRules.GetTeamFormation(formation).Positions;
        var order = AssignFormation(players.Select(p => p.MatchPlayer.Position).ToArray(), slots);
        var reordered = order.Select(index => players[index]).ToArray();

        // Keep the objects, shirts and identities alive so the current restart,
        // replay, statistics and references held by the ball all remain valid.
        for (int slot = 0; slot < slots.Length; slot++)
        {
            var player = reordered[slot];
            player.MatchPlayer.Position = slots[slot];
            players[slot] = player;
            managedTeam.Team.Players[slot] = player.MatchPlayer;
            managedTeam.Team.Team.Players[slot] = player.MatchPlayer.Player;
        }
        managedTeam.Team.Formation = formation;
        managedTeam.Team.Team.Formation = formation;
        managedTeam.Team.TeamTactics = tactics;
        BuildLineup();
    }

    // Find the lowest total movement between the old and new slots. The
    // keeper is locked to their slot. The other 10 have 1024 possible subsets.
    private static int[] AssignFormation(Positions[] current, Positions[] target)
    {
        if (current.Length != 11 || target.Length != 11 || current[0] != Positions.GK || target[0] != Positions.GK)
            throw new InvalidOperationException("Formation must have eleven slots and start with a goalkeeper");
        var formal = FormalPositioning.Current;
        var costs = new float[10, 10];
        for (int from = 0; from < 10; from++)
        for (int to = 0; to < 10; to++)
        {
            var first = formal.GetPosition(current[from + 1]);
            var second = formal.GetPosition(target[to + 1]);
            float depth = first.VerticalPlacement - second.VerticalPlacement;
            float width = first.HorizontalPlacement - second.HorizontalPlacement;
            costs[from, to] = depth * depth + width * width
                + (current[from + 1] == target[to + 1] ? 0f : 0.0001f);
        }

        const int full = (1 << 10) - 1;
        var best = new float[full + 1];
        var previous = new int[full + 1];
        var depthByMask = new int[full + 1];
        for (int mask = 1; mask <= full; mask++)
        {
            best[mask] = float.PositiveInfinity;
            depthByMask[mask] = 1 + depthByMask[mask & (mask - 1)];
        }
        for (int mask = 0; mask < full; mask++)
        for (int from = 0; from < 10; from++)
        {
            int bit = 1 << from;
            if ((mask & bit) != 0) continue;
            int next = mask | bit;
            float cost = best[mask] + costs[from, depthByMask[mask]];
            if (cost >= best[next]) continue;
            best[next] = cost;
            previous[next] = from;
        }

        var order = new int[11];
        int used = full;
        for (int slot = 10; slot > 0; slot--)
        {
            int from = previous[used];
            order[slot] = from + 1;
            used ^= 1 << from;
        }
        return order;
    }

    public void MarkSubstitutionPanelAvailable() { SubstitutionPanelAvailable = true; }

    public int ChangeStyle(string style)
    {
        if (!ApplyStyle(style, false, out int minute, out string error))
            throw new InvalidOperationException("OpenFoot tactic cannot be applied: " + error);
        return minute;
    }

    /// <summary>
    /// Panel entry point: validates the style and refuses to re-apply the active
    /// one, so a repeated click never sends the same order twice.
    /// </summary>
    public bool TryChangeStyle(string style, out int minute, out string error)
        => ApplyStyle(style, true, out minute, out error);

    private bool ApplyStyle(string style, bool rejectSame, out int minute, out string error)
    {
        minute = 0;
        error = null;
        if (!CanChangeStyle || string.IsNullOrEmpty(style) || style == "Possession")
        {
            error = "closed";
            return false;
        }
        if (rejectSame && style == ActivePlayStyle)
        {
            error = "same";
            return false;
        }
        SetPreset(managedTeam, Preset(style));
        minute = Mathf.Clamp(Mathf.CeilToInt(MatchManager.Current.minutes), 1, 90);
        ActivePlayStyle = style;
        StyleMinute = minute;
        StyleVersion++;
        return true;
    }

    public bool CanSubstitute => CanChangeStyle && MatchManager.Current.minutes > 0
        && MatchManager.Current.MatchFlags == MatchStatus.WaitingForKickOff;

    /// <summary>
    /// Single validation path for every substitution source: the in-match panel
    /// and the order files written by the standalone player. Returns false with a
    /// short machine-readable reason instead of throwing.
    /// </summary>
    public bool CheckSubstitution(string off, string on, out string error)
    {
        error = null;
        if (active == null || !CanChangeStyle) { error = "closed"; return false; }
        if (string.IsNullOrEmpty(off) || string.IsNullOrEmpty(on) || off == on) { error = "lineup"; return false; }
        if (substitutions.Count >= SubstitutionLimit) { error = "limit"; return false; }
        var outgoing = lineup.Find(p => p.Id == off);
        var incoming = substitutes.Find(p => p.Id == on);
        if (outgoing == null || incoming == null) { error = "lineup"; return false; }
        // Only another keeper may replace the keeper; outfielders never swap with one.
        if (outgoing.Keeper != incoming.Keeper) { error = "keeper"; return false; }
        return true;
    }

    /// <summary>
    /// Validates and, if the match is at a legal interruption, applies the change.
    /// "waiting" means the request is valid but must be retried at the next stoppage.
    /// </summary>
    public bool TrySubstitute(string off, string on, out int minute, out string error)
    {
        minute = 0;
        if (!CheckSubstitution(off, on, out error)) return false;
        if (!CanSubstitute) { error = "waiting"; return false; }
        minute = ApplySubstitution(off, on);
        error = null;
        return true;
    }

    public int Substitute(string off, string on)
    {
        if (!TrySubstitute(off, on, out int minute, out string error))
            throw new InvalidOperationException("OpenFoot substitution cannot be applied: " + error);
        return minute;
    }

    private int ApplySubstitution(string off, string on)
    {
        var incoming = bench[on];
        int slot = Array.FindIndex(managedTeam.GamePlayers,
            p => playerIds.TryGetValue(p.MatchPlayer.Player, out var id) && id == off);
        if (slot < 0 || managedTeam.GamePlayers[slot].IsGK != incoming.keeper)
            throw new InvalidOperationException("OpenFoot substitution does not match the lineup");

        // Keep the slot object so marks, replay and the planned restart still
        // reference a live controller. Replace its identity, skills and kit.
        var player = managedTeam.GamePlayers[slot];
        var controller = player.PlayerController;
        const BindingFlags fields = BindingFlags.Instance | BindingFlags.NonPublic;
        var kit = typeof(GameTeam).GetField(player.IsGK ? "gkKit" : "mainKit", fields)?.GetValue(managedTeam) as Material;
        var shadow = controller.GetType().GetField("shadow", fields);
        if (kit == null || shadow == null) throw new MissingFieldException("Football Simulator player visuals");

        var matchPlayer = new MatchPlayer(incoming.number, incoming.entry, player.MatchPlayer.Position);
        bool physics = controller.IsPhysicsEnabled;
        (shadow.GetValue(controller) as Transform)?.gameObject.SetActive(false);
        player.MatchPlayer = matchPlayer;
        managedTeam.Team.Players[slot] = matchPlayer;
        managedTeam.Team.Team.Players[slot] = incoming.entry;
        controller.SetPlayer(matchPlayer.Number, player, kit);
        controller.IsPhysicsEnabled = physics;
        controller.UI.SetName(incoming.entry.Name);
        playerIds.Add(incoming.entry, on);
        bench.Remove(on);
        MatchManager.Statistics.ResetPositions();
        BuildLineup();

        int minute = Mathf.Clamp(Mathf.CeilToInt(MatchManager.Current.minutes), 1, 90);
        substitutions.Add(new Substitution { minute = minute, player_off_id = off, player_on_id = on });
        return minute;
    }

    private void BuildLineup()
    {
        lineup.Clear();
        substitutes.Clear();
        if (managedTeam == null) return;
        for (int slot = 0; slot < managedTeam.GamePlayers.Length && slot < 11; slot++)
        {
            var gamePlayer = managedTeam.GamePlayers[slot];
            if (gamePlayer == null || gamePlayer.MatchPlayer == null || gamePlayer.MatchPlayer.Player == null) continue;
            if (!playerIds.TryGetValue(gamePlayer.MatchPlayer.Player, out var id)) continue;
            lineup.Add(new LineupPlayer
            {
                Id = id,
                Name = gamePlayer.MatchPlayer.Player.Name,
                Position = gamePlayer.MatchPlayer.Position.ToString().Replace('_', ' '),
                Slot = gamePlayer.MatchPlayer.Position,
                Role = RoleFor(gamePlayer),
                Number = gamePlayer.MatchPlayer.Number,
                Keeper = gamePlayer.IsGK,
            });
        }
        foreach (var pair in bench)
            substitutes.Add(new LineupPlayer
            {
                Id = pair.Key,
                Name = pair.Value.entry.Name,
                Position = positions.TryGetValue(pair.Key, out var position) ? position : "",
                Number = pair.Value.number,
                Keeper = pair.Value.keeper,
            });
        substitutes.Sort((left, right) => left.Number.CompareTo(right.Number));
        LineupVersion++;
    }

    private void OnGoal(GoalScoredEvent goal)
    {
        if (active == null || ResultJson != null || goal.Scorer == null)
            return;
        // The side in the event gets the goal. The scorer can belong to
        // the other team for an own goal, which the scoreboard still counts.
        if (goal.Scorer.team != (goal.Side ? awayTeam : homeTeam) ||
            !playerIds.TryGetValue(goal.Scorer, out string playerId))
            return;
        goals.Add(new Goal { minute = goal.Minute, side = goal.Side ? "Away" : "Home", player_id = playerId });
    }

    private void OnFinished(FinalWhistleEvent evt) {
        if(active==null || evt==null || ResultJson!=null) return;
        var match=MatchManager.Current;
        ResultJson = JsonUtility.ToJson(new Result {
            request_id = active.request_id,
            home_id = active.home.id,
            away_id = active.away.id,
            home_goals = match.homeTeamScore,
            away_goals = match.awayTeamScore,
            player_ids = active.home.players.Concat(active.away.players).Select(p=>p.id).ToArray(),
            goals = goals.ToArray(),
            substitutions = substitutions.ToArray()
        }, true);
    }
}
