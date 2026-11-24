using System;
using System.Collections.Generic;
using System.Linq;
using FStudio.Data;
using FStudio.Database;
using FStudio.Events;
using FStudio.MatchEngine;
using FStudio.MatchEngine.Balls;
using FStudio.MatchEngine.Enums;
using FStudio.MatchEngine.Events;
using FStudio.MatchEngine.Players;
using UnityEngine;
using Random = UnityEngine.Random;

public sealed class OpenFootMatchRules
{
    [Serializable]
    public sealed class Incident
    {
        public int minute;
        public string side, kind, player_id;
    }

    internal static OpenFootMatchRules Current;
    internal static int PeriodEnd => Current?.periodEnd ?? 90;
    internal static int Minute => Mathf.Clamp(Mathf.CeilToInt(MatchManager.Current.minutes), 1, PeriodEnd);
    internal int TotalMinutes => periodEnd;
    internal int RegulationHome { get; private set; }
    internal int RegulationAway { get; private set; }
    internal bool ShootoutActive => shootout.Active;
    internal OpenFootKnockout.Kick[] ShootoutKicks => shootout.Kicks;

    private readonly Dictionary<PlayerEntry, string> identities;
    private readonly Dictionary<PlayerEntry, OpenFootBridge.Player> attributes = new Dictionary<PlayerEntry, OpenFootBridge.Player>();
    private readonly HashSet<PlayerEntry> cautioned = new HashSet<PlayerEntry>();
    private readonly List<Incident> incidents = new List<Incident>();
    private readonly Action<GameTeam> lineupChanged;
    private readonly bool knockout;
    private readonly Action captureFullTime;
    private readonly OpenFootKnockout shootout = new OpenFootKnockout();
    private int periodEnd = 90;
    private float whistleDeadline;
    private bool shootoutFinished;
    private PlayerBase penaltyTaker;
    private GoalNet penaltyGoal;
    private PlayerEntry penaltyScorer;
    private bool penaltyScoredByAway;
    private bool penaltyInFlight;
    private float penaltyDeadline;
    private float noticeUntil;
    private string notice;

    internal string ActiveNotice => Time.unscaledTime < noticeUntil ? notice : null;

    internal OpenFootMatchRules(Dictionary<PlayerEntry, string> identities, Action<GameTeam> lineupChanged,
        bool knockout, Action captureFullTime)
    {
        this.identities = identities;
        this.lineupChanged = lineupChanged;
        this.knockout = knockout;
        this.captureFullTime = captureFullTime;
    }

    internal void RegisterAttributes(PlayerEntry entry, OpenFootBridge.Player player) => attributes.Add(entry, player);

    internal static int ReactionSkill(PlayerEntry player) =>
        Current?.attributes.ContainsKey(player) == true ? player.reaction : player.positioning;

    internal static int ShotPowerSkill(PlayerEntry player) =>
        Current?.attributes.ContainsKey(player) == true ? player.shootPower : player.shooting;

    internal static float GoalkeepingSkill(MatchPlayer keeper, float legacySkill)
    {
        if (Current?.attributes.ContainsKey(keeper.Player) != true) return legacySkill;
        return keeper.ActualReaction * 0.35f + keeper.ActualBallControl * 0.30f +
            keeper.ActualPositioning * 0.25f + keeper.ActualAgility * 0.10f;
    }

    private float TackleRisk(PlayerBase defender, float risk)
    {
        if (!attributes.TryGetValue(defender.MatchPlayer.Player, out var player)) return risk;
        int leadership = 0;
        foreach (var teammate in defender.GameTeam.GamePlayers)
            if (attributes.TryGetValue(teammate.MatchPlayer.Player, out var profile))
                leadership = Mathf.Max(leadership, profile.leadership);

        float aggressionFactor = 1f + (player.aggression - 70) * 0.004f;
        float leadershipFactor = 1f - (leadership - 70) * 0.003f;
        return Mathf.Clamp01(risk * aggressionFactor * leadershipFactor);
    }

    internal static bool ShouldFinish(MatchManager match, bool naturalWhistle)
    {
        var rules = Current;
        if (rules == null || !rules.knockout) return naturalWhistle;
        if (rules.shootout.Active) return rules.shootoutFinished;
        if (rules.penaltyTaker != null) return false;
        if (rules.whistleDeadline == 0f) rules.whistleDeadline = Time.time + 8f;
        if (!naturalWhistle && Time.time < rules.whistleDeadline) return false;
        rules.whistleDeadline = 0f;

        bool tied = match.homeTeamScore == match.awayTeamScore;
        if (rules.periodEnd == 90)
        {
            rules.RegulationHome = match.homeTeamScore;
            rules.RegulationAway = match.awayTeamScore;
            if (!tied) return true;
            rules.StartExtraPeriod(match, 105, Random.Range(1, 3), "ExtraTimeFirstHalf");
            return false;
        }
        if (rules.periodEnd == 105)
        {
            rules.StartExtraPeriod(match, 120, 3 - match.whichTeamStarted, "ExtraTimeSecondHalf");
            return false;
        }
        if (!tied) return true;

        rules.captureFullTime();
        rules.shootout.Start(match);
        match.MatchFlags = MatchStatus.Freeze;
        EventManager.Trigger(new RefereeLastWhistleEvent());
        rules.ShowNotice("PenaltyShootout", rules.shootout.Score);
        match.WaitForMoment(2, () => rules.StartShootoutKick(match));
        return false;
    }

    private void StartExtraPeriod(MatchManager match, int end, int kickoffTeam, string label)
    {
        periodEnd = end;
        match.MatchFlags = MatchStatus.Freeze;
        EventManager.Trigger(new RefereeShortWhistleEvent());
        ShowNotice(label, null);
        match.WaitForMoment(1.5f, () =>
        {
            match.whichTeamStarted = kickoffTeam;
            match.ResetOffsides();
            Ball.Current.ResetBall(new Vector3(match.SizeOfField.x / 2f, 0f, match.SizeOfField.y / 2f));
            match.PrePositionTeamsForKickOff();
        });
    }

    internal Incident[] Finish()
    {
        if (penaltyInFlight) EndPenalty(false);
        return incidents.ToArray();
    }

    internal void ThrowIn(PlayerBase player) => Record("ThrowIn", player);

    internal PlayerEntry ConsumePenaltyGoal(bool away)
    {
        var scorer = penaltyScoredByAway == away ? penaltyScorer : null;
        penaltyScorer = null;
        if (scorer != null) ShowNotice("PenaltyGoal", scorer.Name);
        return scorer;
    }

    private void Record(string kind, PlayerBase player)
    {
        if (player == null || !identities.TryGetValue(player.MatchPlayer.Player, out var id)) return;
        var match = MatchManager.Current;
        int minute = Minute;
        if (incidents.Count != 0) minute = Mathf.Max(minute, incidents[incidents.Count - 1].minute);
        incidents.Add(new Incident {
            kind = kind,
            minute = minute,
            player_id = id,
            side = player.GameTeam == match.GameTeam1 ? "Home" : "Away"
        });
        ShowNotice(kind, player.MatchPlayer.Player.Name);
    }

    private void ShowNotice(string kind, string player)
    {
        notice = OpenFootRoleLabels.Tactic(kind);
        if (!string.IsNullOrEmpty(player)) notice += " · " + player;
        noticeUntil = Time.unscaledTime + 3.5f;
    }

    internal static bool TryTackle(PlayerBase defender, PlayerBase attacker, bool wonBall, bool late = false)
    {
        var match = MatchManager.Current;
        if (Current == null || Current.shootout.Active || match.MatchFlags != MatchStatus.Playing || attacker == null ||
            defender.GameTeam == attacker.GameTeam || !defender.GameTeam.GamePlayers.Contains(defender) ||
            !attacker.GameTeam.GamePlayers.Contains(attacker)) return false;

        // A contact that misses the ball or comes from behind is riskier. Use the
        // approach at contact time, since the attacker can turn during the slide.
        Vector3 attackerForward = attacker.Rotation * Vector3.forward;
        Vector3 fromAttacker = defender.Position - attacker.Position;
        bool fromBehind = Vector3.Dot(attackerForward, fromAttacker.normalized) < -0.4f;
        float risk = late ? 0.48f : wonBall ? 0.025f : 0.28f;
        if (fromBehind) risk += wonBall ? 0.12f : 0.20f;
        if (Random.value >= Current.TackleRisk(defender, risk)) return false;

        Current.Record("Foul", defender);
        float sanction = Random.value;
        if (sanction < (fromBehind ? 0.045f : 0.012f))
            Current.SendOff(defender, "RedCard");
        else if (sanction < (fromBehind ? 0.48f : 0.20f))
        {
            if (Current.cautioned.Add(defender.MatchPlayer.Player)) Current.Record("YellowCard", defender);
            else Current.SendOff(defender, "SecondYellow");
        }

        var goal = defender.GameTeam == match.GameTeam1 ? match.goalNet1 : match.goalNet2;
        Vector3 spot = attacker.Position;
        float depth = Vector3.Dot(spot - goal.Position, Inward(goal));
        if (depth >= 0 && depth <= 16.5f && Mathf.Abs(spot.z - goal.Position.z) <= 20.16f)
            Current.PreparePenalty(match, attacker.GameTeam, goal);
        else
            FreeKick(match, spot, attacker.GameTeam);
        return true;
    }

    internal static bool TryOffside(PlayerBase player)
    {
        var match = MatchManager.Current;
        if (Current == null || Current.shootout.Active || match.MatchFlags != MatchStatus.Playing || !player.CaughtInOffside ||
            !player.PlayerController.IsPhysicsEnabled || Ball.Current.HolderPlayer != null) return false;

        var opponents = player.GameTeam == match.GameTeam1 ? match.GameTeam2 : match.GameTeam1;
        Current.Record("Offside", player);
        BallOut();
        FreeKick(match, player.Position, opponents);
        return true;
    }

    private static void FreeKick(MatchManager match, Vector3 position, GameTeam receiving)
    {
        Vector3 spot = RestartSpot(match, position);
        match.Foul(FoulType.Foul, spot, receiving, Positions.GK, () =>
        {
            var defending = receiving == match.GameTeam1 ? match.GameTeam2 : match.GameTeam1;
            var goal = defending == match.GameTeam1 ? match.goalNet1 : match.goalNet2;
            foreach (var player in defending.GamePlayers)
            {
                if (player.IsGK) continue;
                Vector3 direction = player.Position - spot;
                direction.y = 0;
                if (direction.sqrMagnitude >= 9.15f * 9.15f) continue;
                if (direction.sqrMagnitude < 0.01f) direction = -Inward(goal);
                Vector3 placement = RestartSpot(match, spot + direction.normalized * 9.3f);
                if ((placement - spot).sqrMagnitude < 9.15f * 9.15f)
                    placement = RestartSpot(match, spot + Inward(goal) * 9.3f);
                player.PlayerController.SetInstantPosition(placement);
                player.PlayerController.SetInstantRotation(Quaternion.LookRotation(spot - placement));
            }
        });
    }

    private static Vector3 RestartSpot(MatchManager match, Vector3 position) => new Vector3(
        Mathf.Clamp(position.x, 0.5f, match.SizeOfField.x - 0.5f), 0f,
        Mathf.Clamp(position.z, 0.5f, match.SizeOfField.y - 0.5f));

    private void SendOff(PlayerBase player, string kind)
    {
        var match = MatchManager.Current;
        var team = player.GameTeam;
        Record(kind, player);
        var remaining = team.GamePlayers.Where(candidate => candidate != player).ToArray();
        team.GamePlayers = remaining;
        MatchManager.AllPlayers = match.GameTeam1.GamePlayers.Concat(match.GameTeam2.GamePlayers);
        player.PlayerController.IsPhysicsEnabled = false;
        player.PlayerController.UnityObject.SetActive(false);
        // The native tackle runs its recovery timer after the whistle. Keep its
        // controller alive until that timer finishes, with no active colliders.
        match.WaitForMoment(3, player.Dispose);
        lineupChanged(team);
    }

    private static Vector3 Inward(GoalNet goal) => new Vector3(Mathf.Sign(goal.Direction.x), 0, 0);

    private void StartShootoutKick(MatchManager match)
    {
        var taker = shootout.NextTaker;
        bool home = taker.GameTeam == match.GameTeam1;
        var defending = home ? match.GameTeam2 : match.GameTeam1;
        var keeper = defending.GamePlayers.FirstOrDefault(player => player.IsGK) ?? defending.GamePlayers[0];
        // The native keeper AI defends its own assigned goal.
        var goal = home ? match.goalNet2 : match.goalNet1;
        var inward = Inward(goal);
        var mark = goal.Position + 11f * inward;
        mark.y = 0f;
        var center = new Vector3(match.SizeOfField.x / 2f, 0f, match.SizeOfField.y / 2f);
        int formationIndex = 0;
        foreach (var player in MatchManager.AllPlayers)
        {
            bool active = player == taker || player == keeper;
            player.PlayerController.IsPhysicsEnabled = active;
            player.InstantStop();
            if (active) continue;
            float angle = formationIndex++ * 2f * Mathf.PI / 22f;
            player.PlayerController.SetInstantPosition(center + 6f * new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)));
        }
        PlacePenalty(match, taker, keeper, goal, mark);
        EventManager.Trigger(new RefereeShortWhistleEvent());
        match.MatchFlags = MatchStatus.WaitingForKickOff;
    }

    private void PlacePenalty(MatchManager match, PlayerBase taker, PlayerBase keeper, GoalNet goal, Vector3 mark)
    {
        var inward = Inward(goal);
        keeper.PlayerController.SetInstantPosition(goal.Position + 0.20f * inward);
        keeper.PlayerController.SetInstantRotation(Quaternion.LookRotation(inward));
        taker.PlayerController.SetInstantPosition(mark + 0.6f * inward);
        taker.PlayerController.SetInstantRotation(Quaternion.LookRotation(-inward));
        match.ResetOffsides();
        Ball.Current.ResetBall(mark);
        Ball.Current.Hold(taker);
        penaltyGoal = goal;
        penaltyTaker = taker;
        penaltyDeadline = Time.time + 5f;
    }

    private void PreparePenalty(MatchManager match, GameTeam attacking, GoalNet goal)
    {
        var ball = Ball.Current;
        var inward = Inward(goal);
        var mark = goal.Position + 11f * inward;
        mark.y = 0;
        match.Foul(FoulType.Foul, mark, attacking, Positions.GK, () =>
        {
            var taker = attacking.GamePlayers.Where(player => !player.IsGK)
                .OrderByDescending(player => player.MatchPlayer.GetShooting()).First();
            var defending = attacking == match.GameTeam1 ? match.GameTeam2 : match.GameTeam1;
            var keeper = defending.GamePlayers.FirstOrDefault(player => player.IsGK) ?? defending.GamePlayers[0];
            foreach (var player in MatchManager.AllPlayers)
            {
                if (player == taker || player == keeper) continue;
                Vector3 position = player.Position;
                float depth = Vector3.Dot(position - goal.Position, inward);
                if (depth < 11f || ((depth < 17f && Mathf.Abs(position.z - mark.z) < 20.7f) ||
                    Vector3.Distance(position, mark) < 9.5f))
                    position.x = goal.Position.x + inward.x * 20.5f;
                player.PlayerController.SetInstantPosition(position);
            }
            PlacePenalty(match, taker, keeper, goal, mark);
            Record("PenaltyAwarded", taker);
        });
    }

    internal static bool TakePenalty(PlayerBase player, float deltaTime)
    {
        var rules = Current;
        if (rules == null || rules.penaltyTaker != player || rules.penaltyInFlight) return false;
        var goal = rules.penaltyGoal;
        if (player.PlayerController.LookTo(in deltaTime, goal.Position - player.Position))
        {
            var target = goal.goalPoints[Random.Range(0, goal.goalPoints.Length)];
            var velocity = goal.GetShootingVectorFromPoint(player, target);
            player.Shoot(velocity);
        }
        return true;
    }

    internal void Tick()
    {
        if (penaltyTaker == null || Time.time < penaltyDeadline) return;
        var ball = Ball.Current;
        if (penaltyInFlight) EndPenalty(false);
        else if (ball.HolderPlayer == penaltyTaker)
        {
            // Recover if an animation is interrupted at the stoppage.
            var target = penaltyGoal.goalPoints[0];
            ball.Shoot(penaltyGoal.GetShootingVectorFromPoint(penaltyTaker, target), penaltyTaker);
        }
        else EndPenalty(false);
    }

    internal static void BallShot(PlayerBase player)
    {
        var rules = Current;
        if (rules?.penaltyTaker == null) return;
        if (rules.penaltyInFlight) rules.EndPenalty(false);
        else if (rules.penaltyTaker == player)
        {
            rules.penaltyInFlight = true;
            rules.penaltyDeadline = Time.time + 3f;
        }
    }

    internal static void BallHeld() => BallOut();

    internal static bool BallOut()
    {
        if (Current?.penaltyInFlight == true) Current.EndPenalty(false);
        return Current?.shootout.Active == true;
    }

    internal static bool BallCrossedGoalLine(bool away)
    {
        if (Current?.penaltyInFlight == true)
            Current.EndPenalty((Current.penaltyTaker.GameTeam == MatchManager.Current.GameTeam2) == away);
        return Current?.shootout.Active == true;
    }

    private void EndPenalty(bool scored)
    {
        if (shootout.Active)
        {
            var match = MatchManager.Current;
            shootout.Record(identities[penaltyTaker.MatchPlayer.Player], scored);
            ShowNotice(scored ? "PenaltyGoal" : "PenaltyMiss", penaltyTaker.MatchPlayer.Player.Name + " · " + shootout.Score);
            match.MatchFlags = MatchStatus.Freeze;
            match.WaitForMoment(2, () =>
            {
                if (!shootout.Decided) { StartShootoutKick(match); return; }
                shootoutFinished = true;
                match.MatchFlags = MatchStatus.Playing;
            });
        }
        else if (scored)
        {
            penaltyScorer = penaltyTaker.MatchPlayer.Player;
            penaltyScoredByAway = penaltyTaker.GameTeam == MatchManager.Current.GameTeam2;
        }
        else Record("PenaltyMiss", penaltyTaker);
        penaltyInFlight = false;
        penaltyTaker = null;
    }
}
