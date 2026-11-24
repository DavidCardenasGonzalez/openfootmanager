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
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
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
    [Serializable] public class Player
    {
        public string id, name, position, role;
        public int number;
        public int pace, stamina, strength, agility, aerial;
        public int passing, shooting, tackling, dribbling, defending;
        public int positioning, vision, decisions, composure, aggression, teamwork, leadership;
        public int handling, reflexes, condition, fitness, ovr;
    }
    [Serializable] public class Team { public string id, name, formation, play_style; public OpenFootTacticsSettings tactics; public Player[] players, bench; public OpenFootKitCatalog.Kits kits; }
    [Serializable] public class Request { public int version, max_subs; public bool use_condition, allows_extra_time, use_balanced_attributes; public string request_id; public Team home, away; }
    [Serializable] public class Result { public int version=1; public string request_id, status="finished", home_id, away_id; public int home_goals, away_goals, total_minutes, regulation_home_goals, regulation_away_goals; public string[] player_ids; public Goal[] goals; public Substitution[] substitutions; public OpenFootMatchStatistics statistics; public OpenFootKnockout.Kick[] shootout; }
    [Serializable] public class Goal { public int minute; public string side, player_id; public bool penalty; }
    [Serializable] public class Substitution { public int minute; public string player_off_id, player_on_id; }

    // Read-only snapshot for the in-match panel. Both the Unity panel and the
    // standalone order queue read the same lists and use the same validation.
    public sealed class LineupPlayer
    {
        public string Id, Name, Position, Role;
        public Positions Slot;
        public int Number;
        public bool Keeper;
        public int Overall, Condition;
        public float Rating;
        internal PlayerEntry Entry;
    }

    private readonly Dictionary<PlayerEntry, string> playerIds = new Dictionary<PlayerEntry, string>();
    private readonly Dictionary<string, string> positions = new Dictionary<string, string>();
    private readonly Dictionary<string, string> playerRoles = new Dictionary<string, string>();
    private readonly Dictionary<PlayerEntry, int> overalls = new Dictionary<PlayerEntry, int>();
    private readonly List<Goal> goals = new List<Goal>();
    private readonly List<Substitution> substitutions = new List<Substitution>();
    private readonly List<LineupPlayer> lineup = new List<LineupPlayer>();
    private readonly List<LineupPlayer> substitutes = new List<LineupPlayer>();
    private readonly Dictionary<string, (PlayerEntry entry, int number, bool keeper)> bench =
        new Dictionary<string, (PlayerEntry, int, bool)>();
    private TeamEntry homeTeam, awayTeam;
    private readonly List<KitEntry> matchKits = new List<KitEntry>();
    private Request active;
    private GameTeam managedTeam;
    private bool kickedOff;
    private OpenFootFormationDraft pendingFormation;
    private readonly Dictionary<Formations, AsyncOperationHandle<TeamTactics>> formationAssets =
        new Dictionary<Formations, AsyncOperationHandle<TeamTactics>>();
    private OpenFootTeamTactics teamTactics;
    private OpenFootMatchRules matchRules;
    private OpenFootMatchCondition matchCondition;
    private OpenFootMatchStatistics fullTimeStatistics;
    public string ResultJson { get; private set; }
    internal string RefereeNotice => matchRules?.ActiveNotice;
    public bool Loading { get; private set; }
    public string LastError { get; private set; }

    private void OnEnable()
    {
        EventManager.Subscribe<MatchInitializationCompletedEvent>(OnTeamsReady);
        EventManager.Subscribe<FirstWhistleEvent>(OnFirstWhistle);
        EventManager.Subscribe<GoalScoredEvent>(OnGoal);
        EventManager.Subscribe<FinalWhistleEvent>(OnFinished);
        EventManager.Subscribe<PlayerThrowInEvent>(OnThrowIn);
    }

    private void OnDisable()
    {
        EventManager.UnSubscribe<MatchInitializationCompletedEvent>(OnTeamsReady);
        EventManager.UnSubscribe<FirstWhistleEvent>(OnFirstWhistle);
        EventManager.UnSubscribe<GoalScoredEvent>(OnGoal);
        EventManager.UnSubscribe<FinalWhistleEvent>(OnFinished);
        EventManager.UnSubscribe<PlayerThrowInEvent>(OnThrowIn);
        if (OpenFootMatchRules.Current == matchRules) OpenFootMatchRules.Current = null;
    }

    private void OnDestroy()
    {
        ReleaseMatchKits();
        matchCondition?.Dispose();
        teamTactics?.Dispose();
        foreach (var asset in formationAssets.Values)
            if (asset.IsValid()) Addressables.Release(asset);
    }

    public async Task Begin(string json)
    {
        if(active!=null || Loading) throw new InvalidOperationException("Bridge already has a match");
        var request=JsonUtility.FromJson<Request>(json);
        if(request==null || request.version!=1 || string.IsNullOrEmpty(request.request_id)) throw new ArgumentException("Invalid bridge request");
        Validate(request.home, request.use_balanced_attributes); Validate(request.away, request.use_balanced_attributes);
        if (!string.IsNullOrEmpty(request.home.play_style) && !string.IsNullOrEmpty(request.away.play_style))
            throw new ArgumentException("Only one team can be controlled by OpenFoot");
        if(request.home.id==request.away.id || request.home.players.Concat(request.away.players).Select(p=>p.id).Distinct().Count()!=22) throw new ArgumentException("Duplicate identities");
        var templates=DatabaseService.LoadTeams();
        if(templates.Length<2) throw new InvalidOperationException("Template teams are missing");
        Loading=true; LastError=null; ResultJson=null;
        try {
            playerIds.Clear();
            overalls.Clear();
            matchCondition?.Dispose();
            matchCondition = new OpenFootMatchCondition();
            fullTimeStatistics = null;
            matchRules = new OpenFootMatchRules(playerIds, OnLineupChangedByReferee,
                request.allows_extra_time, CaptureFullTimeStatistics);
            OpenFootMatchRules.Current = matchRules;
            positions.Clear();
            playerRoles.Clear();
            goals.Clear();
            substitutions.Clear();
            lineup.Clear();
            substitutes.Clear();
            bench.Clear();
            var match = new MatchCreateRequest(
                ConvertTeam(request.home, templates[0], request.use_balanced_attributes),
                ConvertTeam(request.away, templates[1], request.use_balanced_attributes));
            // MatchCreateRequest clones each team and its players.
            homeTeam = match.homeTeam;
            awayTeam = match.awayTeam;
            for (int slot = 0; slot < 11; slot++)
            {
                var home = request.home.players[slot];
                var away = request.away.players[slot];
                playerIds.Add(homeTeam.Players[slot], home.id);
                playerIds.Add(awayTeam.Players[slot], away.id);
                RegisterCondition(homeTeam.Players[slot], home, request.use_condition);
                RegisterCondition(awayTeam.Players[slot], away, request.use_condition);
                if (request.use_balanced_attributes)
                {
                    matchRules.RegisterAttributes(homeTeam.Players[slot], home);
                    matchRules.RegisterAttributes(awayTeam.Players[slot], away);
                }
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
                    ValidatePlayer(data, request.use_balanced_attributes);
                    if (playerIds.ContainsValue(data.id) || bench.ContainsKey(data.id))
                        throw new ArgumentException("Duplicate reserve identity");
                    var entry = reserveTeam.Players[index % 11].Clone(reserveTeam);
                    entry.id = id++;
                    SetAttributes(entry, data, request.use_balanced_attributes);
                    if (request.use_balanced_attributes) matchRules.RegisterAttributes(entry, data);
                    bench.Add(data.id, (entry, data.number > 0 ? data.number : index + 12, data.position == "Goalkeeper"));
                    RegisterCondition(entry, data, request.use_condition);
                    positions[data.id] = data.position;
                }
            }
            active=request;
            await StartObservedMatch(match);
        } catch(Exception error) { active=null; ReleaseMatchKits(); LastError=error.ToString(); throw; }
        finally { Loading=false; }
    }

    private void RegisterCondition(PlayerEntry entry, Player data, bool useCondition)
    {
        if (useCondition && (data.condition < 0 || data.condition > 100 || data.fitness < 0 ||
            data.fitness > 100 || data.stamina < 0 || data.stamina > 100))
            throw new ArgumentException("Invalid match condition");
        matchCondition.Register(entry, useCondition ? data.condition : 100,
            useCondition ? data.fitness : 75, useCondition ? data.stamina : 50);
        overalls.Add(entry, data.ovr);
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
    private static void Validate(Team team, bool balancedAttributes) {
        Formations formation;
        if(team==null || string.IsNullOrEmpty(team.id) || team.players==null || team.players.Length!=11 || !Enum.TryParse(team.formation,out formation) || formation==Formations.ParametersCount) throw new ArgumentException("Invalid team");
        foreach (var player in team.players) ValidatePlayer(player, balancedAttributes);
    }
    private static void ValidatePlayer(Player p, bool balancedAttributes)
    {
        if (p == null || string.IsNullOrEmpty(p.id)) throw new ArgumentException("Missing player");
        foreach (var n in new[] { p.pace, p.passing, p.shooting, p.tackling, p.dribbling, p.strength, p.positioning, p.agility, p.reflexes })
            if (n < 0 || n > 100) throw new ArgumentException("Invalid attribute");
        if (balancedAttributes)
            foreach (var n in new[] { p.aerial, p.defending, p.vision, p.decisions, p.composure, p.aggression, p.teamwork, p.leadership, p.handling })
                if (n < 0 || n > 100) throw new ArgumentException("Invalid attribute");
    }

    private TeamEntry ConvertTeam(Team input, TeamEntry template, bool balancedAttributes) {
        var team=(TeamEntry)template.Clone(); team.TeamName=input.name; team.Formation=(Formations)Enum.Parse(typeof(Formations),input.formation);
        team.HomeKit = ApplyKit(team.HomeKit, input.kits?.home);
        team.AwayKit = ApplyKit(team.AwayKit, input.kits?.away);
        for (int i = 0; i < 11; i++) SetAttributes(team.Players[i], input.players[i], balancedAttributes);
        return team;
    }

    private KitEntry ApplyKit(KitEntry template, OpenFootKitCatalog.Kit kit)
    {
        var applied = OpenFootKitCatalog.CreateKit(template, kit);
        if (applied == null) return template;
        matchKits.Add(applied);
        return applied;
    }

    private void ReleaseMatchKits()
    {
        foreach (var kit in matchKits) Destroy(kit);
        matchKits.Clear();
    }

    internal static void SetAttributes(PlayerEntry to, Player from, bool balancedAttributes)
    {
        to.Name = to.name = from.name;
        to.Number = from.number;
        to.OpenFootOverall = from.ovr;
        to.strength = from.strength;
        to.agility = from.agility;
        if (!balancedAttributes)
        {
            to.topSpeed = to.acceleration = from.pace;
            to.passing = to.longBall = from.passing;
            to.shooting = to.shootPower = from.shooting;
            to.tackling = from.tackling;
            to.ballControl = to.ballKeeping = to.dribbleSpeed = from.dribbling;
            to.positioning = from.positioning;
            to.reaction = from.reflexes;
            return;
        }

        int Round(float value) => Mathf.RoundToInt(value);
        bool keeper = from.position == "Goalkeeper";
        // The simulator multiplies acceleration and top speed when ranking races for the ball.
        to.topSpeed = Round(Mathf.Lerp(70f, from.pace, 0.55f));
        to.acceleration = Round(17.5f + from.pace * 0.35f + from.agility * 0.40f);
        to.dribbleSpeed = Round(from.dribbling * 0.75f + from.agility * 0.25f);
        to.passing = Round(from.passing * 0.72f + from.vision * 0.18f + from.teamwork * 0.10f);
        to.longBall = Round(from.passing * 0.68f + from.vision * 0.26f + from.decisions * 0.06f);
        to.shooting = Round(from.shooting * 0.72f + from.composure * 0.18f + from.decisions * 0.10f);
        to.shootPower = from.shooting;
        to.tackling = Round(from.tackling * 0.72f + from.defending * 0.24f + from.aggression * 0.04f);
        to.ballControl = keeper ? from.handling : Round(from.dribbling * 0.80f + from.composure * 0.20f);
        to.ballKeeping = Round(from.dribbling * 0.70f + from.strength * 0.20f + from.composure * 0.10f);
        to.positioning = keeper ? from.positioning : Round(from.positioning * 0.60f + from.defending * 0.25f + from.decisions * 0.15f);
        to.reaction = keeper ? from.reflexes : from.decisions;
        to.jump = Round(from.aerial * 0.80f + from.strength * 0.20f);
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
        matchCondition.Update(match);
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
        teamTactics = new OpenFootTeamTactics(managedTeam, input.tactics, input.play_style);
        OpenFootPlayerRoles.BindTeam(managedTeam.GamePlayers, RoleFor, teamTactics);
        ActivePlayStyle = input.play_style;
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

    public bool CanChangeStyle => kickedOff && managedTeam != null && ResultJson == null && !matchRules.ShootoutActive;
    internal OpenFootTacticsSettings TacticalSettings => teamTactics.Settings;
    public int TacticsMinute { get; private set; }

    internal bool TryCycleTactic(OpenFootTacticsSettings.Dial dial)
    {
        if (!CanChangeStyle || FormationPending) return false;
        int index = Array.IndexOf(dial.Options, dial.Read(TacticalSettings));
        dial.Write(TacticalSettings, dial.Options[(index + 1) % dial.Options.Length]);
        teamTactics.Apply(ActivePlayStyle);
        TacticsMinute = OpenFootMatchRules.Minute;
        return true;
    }
    public bool HasSubstitutes => bench.Count > 0;

    /// <summary>True once the in-match substitution panel finished installing.</summary>
    public bool SubstitutionPanelAvailable { get; private set; }
    public IReadOnlyList<LineupPlayer> Lineup => lineup;
    public IReadOnlyList<LineupPlayer> Substitutes => substitutes;
    public int SubstitutionsUsed => substitutions.Count;
    public int SubstitutionLimit => active == null ? 0 : active.max_subs;
    public int SubstitutionsRemaining => Mathf.Max(0, SubstitutionLimit - substitutions.Count);
    public int LineupVersion { get; private set; }
    public string HomeTeamName => active?.home.name ?? "";
    public string AwayTeamName => active?.away.name ?? "";
    public bool ManagedIsHome => !string.IsNullOrEmpty(active?.home.play_style);
    public int HomeGoals => MatchManager.Current?.homeTeamScore ?? 0;
    public int AwayGoals => MatchManager.Current?.awayTeamScore ?? 0;
    public int MatchMinute => (int)(MatchManager.Current?.minutes ?? 0f);

    public void RefreshVitals()
    {
        if (matchCondition == null) return;
        var stats = MatchManager.Statistics;
        foreach (var player in lineup)
        {
            player.Condition = matchCondition.Remaining(player.Entry);
            if (MatchMinute > 0 && stats != null && stats.runningDistance.PlayerDistances.ContainsKey(player.Entry.id))
                player.Rating = Mathf.Clamp(stats.PlayerRating(player.Entry.id), 0f, 10f);
        }
        foreach (var player in substitutes)
            player.Condition = matchCondition.Remaining(player.Entry);
    }

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
    internal Formations ActiveFormationId => managedTeam.Team.Formation;
    public bool FormationPending => pendingFormation != null;
    public string PendingFormation => FormationPending ? FormationName(pendingFormation.Formation) : "";
    internal OpenFootFormationDraft QueuedFormation => pendingFormation;
    public int FormationMinute { get; private set; }
    public int FormationVersion { get; private set; }
    public bool FormationFailed { get; private set; }

    // The manager uses variant A when exporting 4-2-3-1.
    private static readonly Formations[] SupportedFormations =
    {
        Formations._4_4_2, Formations._4_3_3, Formations._4_2_3_1_A, Formations._4_1_4_1,
        Formations._4_1_3_2, Formations._4_3_2_1, Formations._3_5_2, Formations._3_4_3,
        Formations._5_3_2, Formations._5_4_1, Formations._5_2_3, Formations._2_3_5,
    };

    internal static string FormationName(Formations formation) =>
        formation == Formations._4_2_3_1_A ? "4-2-3-1" : formation.ToString().TrimStart('_').Replace('_', '-');

    private static AssetReferenceT<TeamTactics> FormationAsset(Formations formation) =>
        PlayableFormations.Current.Formations.Entries
            .FirstOrDefault(entry => entry.Id == formation && entry.Val != null && entry.Val.RuntimeKeyIsValid())?.Val;

    internal IEnumerable<Formations> FormationOptions =>
        SupportedFormations.Where(formation => FormationAsset(formation) != null);

    internal OpenFootFormationDraft DraftFormation(Formations formation)
    {
        if (!CanChangeStyle || FormationPending || lineup.Count != 11 || !FormationOptions.Contains(formation))
            return null;
        var slots = FormationRules.GetTeamFormation(formation).Positions;
        var order = AssignFormation(lineup.Select(player => player.Slot).ToArray(), slots);
        return new OpenFootFormationDraft(formation, LineupVersion, slots, order.Select(index => lineup[index]));
    }

    internal string ProjectedRole(string playerId, Positions slot) =>
        playerRoles.TryGetValue(playerId, out var role)
            ? OpenFootPlayerRoles.Effective(slot, role)
            : OpenFootPlayerRoles.Standard;

    internal bool CanQueueFormation(OpenFootFormationDraft draft) =>
        CanChangeStyle && !FormationPending && draft != null && draft.LineupVersion == LineupVersion &&
        (draft.Formation != managedTeam.Team.Formation ||
            !draft.Players.Select(player => player.Id).SequenceEqual(lineup.Select(player => player.Id)));

    internal bool TryQueueFormation(OpenFootFormationDraft draft)
    {
        if (!CanQueueFormation(draft)) return false;
        if (!formationAssets.ContainsKey(draft.Formation))
        {
            var asset = FormationAsset(draft.Formation);
            if (asset == null) return false;
            formationAssets.Add(draft.Formation, Addressables.LoadAssetAsync<TeamTactics>(asset));
        }
        pendingFormation = draft.Copy();
        FormationFailed = false;
        FormationVersion++;
        return true;
    }

    private void Update()
    {
        if (ResultJson == null) matchRules?.Tick();
        if (CanChangeStyle && Ball.Current != null && MatchManager.Current != null)
            teamTactics.Tick(Ball.Current.HolderTeam, MatchManager.Current.MatchFlags == MatchStatus.Playing, Time.time);
        if (!FormationPending) return;
        if (ResultJson != null)
        {
            pendingFormation = null;
            return;
        }
        var asset = formationAssets[pendingFormation.Formation];
        if (!asset.IsDone) return;
        if (asset.Status == AsyncOperationStatus.Succeeded && !CanSubstitute) return;
        try
        {
            if (asset.Status != AsyncOperationStatus.Succeeded || asset.Result == null)
                throw new InvalidOperationException("Formation has no tactical data", asset.OperationException);
            if (pendingFormation.LineupVersion != LineupVersion)
                throw new InvalidOperationException("Lineup changed after the formation was confirmed");
            ApplyFormation(pendingFormation, asset.Result);
            FormationMinute = OpenFootMatchRules.Minute;
        }
        catch (Exception error)
        {
            FormationFailed = true;
            if (asset.Status != AsyncOperationStatus.Succeeded || asset.Result == null)
            {
                formationAssets.Remove(pendingFormation.Formation);
                Addressables.Release(asset);
            }
            Debug.LogException(error);
        }
        finally
        {
            pendingFormation = null;
            FormationVersion++;
        }
    }

    private void LateUpdate()
    {
        if (kickedOff && ResultJson == null && MatchManager.Current != null)
            matchCondition.Update(MatchManager.Current);
    }

    private void ApplyFormation(OpenFootFormationDraft draft, TeamTactics tactics)
    {
        var players = managedTeam.GamePlayers;
        var byId = players.ToDictionary(player => playerIds[player.MatchPlayer.Player]);
        var reordered = draft.Players.Select(player => byId[player.Id]).ToArray();
        teamTactics.SetFormation(tactics);

        // Keep the objects, shirts and identities alive so the current restart,
        // replay, statistics and references held by the ball all remain valid.
        for (int slot = 0; slot < draft.Slots.Count; slot++)
        {
            var player = reordered[slot];
            if (player.MatchPlayer.Position != draft.Slots[slot] && player.ActiveBehaviour?.ForceBehaviour != true)
                player.NextBehaviour = 0f;
            player.MatchPlayer.Position = draft.Slots[slot];
            players[slot] = player;
            managedTeam.Team.Players[slot] = player.MatchPlayer;
            managedTeam.Team.Team.Players[slot] = player.MatchPlayer.Player;
        }
        managedTeam.Team.Formation = draft.Formation;
        managedTeam.Team.Team.Formation = draft.Formation;
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
        if (!CanChangeStyle || string.IsNullOrEmpty(style))
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
        teamTactics.Apply(style);
        minute = OpenFootMatchRules.Minute;
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
        matchCondition.Hide(player.MatchPlayer.Player);
        bool physics = controller.IsPhysicsEnabled;
        (shadow.GetValue(controller) as Transform)?.gameObject.SetActive(false);
        int rosterSlot = Array.IndexOf(managedTeam.Team.Players, player.MatchPlayer);
        player.MatchPlayer = matchPlayer;
        if (rosterSlot >= 0)
        {
            managedTeam.Team.Players[rosterSlot] = matchPlayer;
            managedTeam.Team.Team.Players[rosterSlot] = incoming.entry;
        }
        controller.SetPlayer(matchPlayer.Number, player, kit);
        controller.IsPhysicsEnabled = physics;
        controller.UI.SetName(incoming.entry.Name);
        matchCondition.ApplyTo(player);
        playerIds.Add(incoming.entry, on);
        bench.Remove(on);
        MatchManager.Statistics.ResetPositions();
        BuildLineup();

        int minute = OpenFootMatchRules.Minute;
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
                Entry = gamePlayer.MatchPlayer.Player,
                Overall = overalls[gamePlayer.MatchPlayer.Player],
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
                Entry = pair.Value.entry,
                Overall = overalls[pair.Value.entry],
            });
        substitutes.Sort((left, right) => left.Number.CompareTo(right.Number));
        RefreshVitals();
        LineupVersion++;
    }

    private void OnGoal(GoalScoredEvent goal)
    {
        if (active == null || ResultJson != null)
            return;
        // The side in the event gets the goal. The scorer can belong to
        // the other team for an own goal, which the scoreboard still counts.
        var penaltyTaker = matchRules.ConsumePenaltyGoal(goal.Side);
        var scorer = penaltyTaker ?? goal.Scorer;
        if (scorer == null || scorer.team != (goal.Side ? awayTeam : homeTeam) ||
            !playerIds.TryGetValue(scorer, out string playerId))
            return;
        goals.Add(new Goal {
            minute = goal.Minute, side = goal.Side ? "Away" : "Home", player_id = playerId,
            penalty = penaltyTaker != null
        });
    }

    private void OnThrowIn(PlayerThrowInEvent incident)
    {
        if (active != null && ResultJson == null) matchRules.ThrowIn(incident.Player);
    }

    private void OnLineupChangedByReferee(GameTeam team)
    {
        if (team == managedTeam) BuildLineup();
    }

    private void CaptureFullTimeStatistics()
    {
        var match = MatchManager.Current;
        matchCondition.Update(match);
        fullTimeStatistics = OpenFootMatchStatistics.Capture(match, playerIds, matchRules.Finish(),
            matchCondition.Remaining, active.use_condition);
    }

    private void OnFinished(FinalWhistleEvent evt) {
        if(active==null || evt==null || ResultJson!=null) return;
        var match=MatchManager.Current;
        if (fullTimeStatistics == null) CaptureFullTimeStatistics();
        ResultJson = JsonUtility.ToJson(new Result {
            request_id = active.request_id,
            home_id = active.home.id,
            away_id = active.away.id,
            home_goals = match.homeTeamScore,
            away_goals = match.awayTeamScore,
            total_minutes = matchRules.TotalMinutes,
            regulation_home_goals = matchRules.RegulationHome,
            regulation_away_goals = matchRules.RegulationAway,
            player_ids = active.home.players.Concat(active.away.players).Select(p=>p.id).ToArray(),
            goals = goals.ToArray(),
            substitutions = substitutions.ToArray(),
            statistics = fullTimeStatistics,
            shootout = matchRules.ShootoutKicks
        }, true);
        matchCondition.Dispose();
        matchCondition = null;
        if (OpenFootMatchRules.Current == matchRules) OpenFootMatchRules.Current = null;
    }
}
