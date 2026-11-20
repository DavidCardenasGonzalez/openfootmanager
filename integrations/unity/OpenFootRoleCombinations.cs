using System;
using FStudio.Data;
using FStudio.MatchEngine.Enums;
using FStudio.MatchEngine.Players;
using FStudio.MatchEngine.Players.Behaviours;
using UnityEngine;

public static partial class OpenFootPlayerRoles
{
    private static bool Available(PlayerBase p) => p.PlayerController.IsPhysicsEnabled &&
        !p.IsInOffside && !p.CaughtInOffside;

    private static float NearestDistance(Vector3 point, PlayerBase[] players)
    {
        float best = float.PositiveInfinity;
        foreach (var p in players)
            if (p.PlayerController.IsPhysicsEnabled) best = Mathf.Min(best, (point - p.Position).sqrMagnitude);
        return Mathf.Sqrt(best);
    }

    private static bool HasSupport(PlayerBase receiver, PlayerBase passer, PlayerBase[] team, float radius)
    {
        foreach (var p in team)
            if (p != receiver && p != passer && !p.IsGK && Available(p)
                && (p.Position - receiver.Position).sqrMagnitude <= radius * radius) return true;
        return false;
    }

    internal static float DistanceToLane(Vector3 start, Vector3 end, Vector3 marker)
    {
        var lane = end - start;
        float along = Mathf.Clamp01(Vector3.Dot(marker - start, lane) / Mathf.Max(0.01f, lane.sqrMagnitude));
        return Vector3.Distance(marker, start + lane * along);
    }

    private static bool LaneOpen(Vector3 from, Vector3 to, PlayerBase[] opponents, float margin)
    {
        foreach (var p in opponents)
            if (p.PlayerController.IsPhysicsEnabled && DistanceToLane(from, to, p.Position) < margin) return false;
        return true;
    }

    // Pick one onside runner for one dropping striker. Share the choice across
    // the XI so that both movements refer to the same channel.
    private sealed class ForwardMovement
    {
        private readonly Func<PlayerBase, string> resolve;
        private float nextScan;
        private PlayerBase lastHolder;
        public PlayerBase Nine, Runner;
        public float Channel;

        public ForwardMovement(Func<PlayerBase, string> resolve) => this.resolve = resolve;

        public void Update(float time, PlayerBase[] team, PlayerBase[] opponents, PlayerBase holder,
            float direction, float line)
        {
            if (time < nextScan && holder == lastHolder) return;
            nextScan = time + 0.4f;
            lastHolder = holder;
            var previous = Runner;
            Nine = Runner = null;
            if (holder.IsGK || holder.GameTeam.BallProgress < 0.26f) return;
            float best = float.PositiveInfinity;
            foreach (var nine in team)
            {
                if (resolve(nine) != "False9" || !Available(nine) || nine == holder) continue;
                foreach (var p in team)
                {
                    if (p == nine || p == holder || !Available(p)) continue;
                    var slot = p.MatchPlayer.Position;
                    const Positions runners = Positions.LW | Positions.RW | Positions.LMF | Positions.RMF |
                        Positions.AMF | Positions.AMF_L | Positions.AMF_R | Positions.ST | Positions.ST_L | Positions.ST_R;
                    if ((slot & runners) == 0 || resolve(p) == "False9") continue;
                    if ((line - p.Position.x) * direction < 0.75f) continue;
                    var gap = nine.Position + Vector3.right * direction * 5f;
                    if (!LaneOpen(p.Position, gap, opponents, 1.6f)) continue;
                    float distance = Vector3.Distance(p.Position, gap);
                    if (distance > 29f) continue;
                    float score = distance - (previous == p ? 4f : 0f) + (resolve(p) == "TargetMan" ? 7f : 0f);
                    if (score >= best) continue;
                    best = score;
                    Nine = nine;
                    Runner = p;
                    Channel = gap.z;
                }
            }
        }
    }

    // Only replace a normal pass when there is a viable receiver, a real
    // outlet for the layoff and the simulator itself validates the pass.
    private static bool TryFeedReference(PlayerBase passer, PlayerBase[] team, PlayerBase[] opponents,
        Func<PlayerBase, string> resolve, Vector3 goal, in float delta, PlayerBase[] candidate)
    {
        if (passer.GameTeam.BallProgress < 0.16f || passer.GameTeam.BallProgress > 0.78f) return false;
        foreach (var target in team)
        {
            if (target == passer || resolve(target) != "TargetMan" || !Available(target)) continue;
            float distance = Vector3.Distance(passer.Position, target.Position);
            if (distance < 10f || distance > 40f || !passer.IsFrontOfMe(target.Position, 3f)
                || !HasSupport(target, passer, team, 15f)) continue;
            bool canHold = true;
            foreach (var marker in opponents)
            {
                if (marker.PlayerController.IsPhysicsEnabled && (marker.Position - target.Position).sqrMagnitude < 16f
                    && marker.MatchPlayer.ActualStrength > target.MatchPlayer.ActualStrength + 8) canHold = false;
            }
            if (!canHold) continue;
            candidate[0] = target;
            var pass = passer.FindPassTarget(in candidate, in goal);
            if (!pass.IsValid || pass._ActualTarget != target) continue;
            bool loft = pass._PassType == PlayerBase.PassType.LongPass;
            if (!loft && !LaneOpen(passer.Position, pass._Position, opponents, 1.35f)) continue;
            passer.CurrentAct = Acts.PassingToBetterOpportunity;
            passer.Stop(in delta);
            if (passer.LookTo(in delta, pass._Position - passer.Position))
            {
                passer.PassingTarget = target;
                if (loft) passer.Cross(pass._Position);
                else passer.Pass(pass._Position, passer.SpeedModForPassing() * pass._PassPower);
            }
            return true;
        }
        return false;
    }

    private sealed class OfferKeeperOutlet : BaseBehaviour
    {
        private readonly Func<PlayerBase, string> resolve;
        public OfferKeeperOutlet(Func<PlayerBase, string> resolve) => this.resolve = resolve;
        public override bool Behave(bool active)
        {
            var keeper = ball.HolderPlayer;
            if (isInputControlled || keeper == null || !keeper.IsGK || keeper.GameTeam != Player.GameTeam
                || !(keeper.IsGKUntouchable || keeper.IsGoalKickHolder) || resolve(keeper) != "BallPlayingKeeper")
                return false;
            float side;
            switch (Player.MatchPlayer.Position)
            {
                case Positions.CB_L: side = 1f; break;
                case Positions.CB_R: side = -1f; break;
                default: return false;
            }
            var target = keeper.Position + new Vector3(11f * goalNet.Direction.x, 0f, 10f * side * goalNet.Direction.x);
            KeepInField(ref target);
            Player.CurrentAct = Acts.TacticalPositioning;
            Player.MoveTo(in deltaTime, target, false);
            Player.FocusToBall(in deltaTime, ball);
            return true;
        }
    }

    private sealed class ShortDistribution : BaseBehaviour
    {
        private readonly Func<PlayerBase, string> resolve;
        private readonly bool restart;
        public ShortDistribution(Func<PlayerBase, string> resolve, bool restart)
        {
            this.resolve = resolve;
            this.restart = restart;
        }
        public override bool Behave(bool active)
        {
            if (isInputControlled || !Player.IsHoldingBall || Player.IsGoalKickHolder != restart
                || (!restart && matchStatus != MatchStatus.Playing) || resolve(Player) != "BallPlayingKeeper"
                || NearestDistance(Player.Position, opponents) < 4f) return false;
            PlayerBase best = null;
            float bestScore = float.NegativeInfinity;
            foreach (var p in teammates)
            {
                if (p == Player || !Available(p) || !Player.IsFrontOfMe(p.Position, 1.5f)) continue;
                float distance = Vector3.Distance(Player.Position, p.Position);
                if (distance < 5f || distance > 22f) continue;
                float space = NearestDistance(p.Position, opponents);
                if (space < 4f || !LaneOpen(Player.Position, p.Position, opponents, 2.2f)) continue;
                float score = Mathf.Min(space, 12f) - Mathf.Abs(distance - 14f) * 0.35f;
                if (score <= bestScore) continue;
                best = p;
                bestScore = score;
            }
            if (best == null) return false;
            Player.Stop(in deltaTime);
            if (Player.LookTo(in deltaTime, best.Position - Player.Position))
            {
                Player.PassingTarget = best;
                if (!restart && Player.IsGKUntouchable) Player.Cross(best.Position);
                else Player.Pass(best.Position);
            }
            return true;
        }
    }

    private sealed class SweepDecision : BaseBehaviour
    {
        private readonly Func<PlayerBase, string> resolve;
        public SweepDecision(Func<PlayerBase, string> resolve) => this.resolve = resolve;
        private static float Arrival(PlayerBase p, Vector3 point) =>
            Vector3.Distance(p.Position, point) / Mathf.Lerp(4.4f, 8f, p.MatchPlayer.ActualTopSpeed / 100f);

        public override bool Behave(bool active)
        {
            if (isInputControlled || matchStatus != MatchStatus.Playing || ball.HolderPlayer != null
                || ball.LastHolder == null || ball.LastHolder.GameTeam == Player.GameTeam
                || resolve(Player) != "SweeperKeeper") return false;
            var position = ball.transform.position;
            var velocity = ball.Velocity;
            float direction = goalNet.Direction.x;
            if (position.y > 1.5f || velocity.x * direction > 1f) return false;
            // On-target shots belong to GKShieldBehaviour and its dive animation.
            float towards = -velocity.x * direction;
            float depth = (position.x - goalNet.Position.x) * direction;
            if (towards > 4f && Mathf.Abs(position.z + velocity.z * depth / towards - goalNet.Position.z) < 5f)
                return false;
            var point = position + velocity * Mathf.Clamp(Arrival(Player, position) * 0.65f, 0.1f, 0.85f);
            point.y = 0f;
            float forward = (point.x - goalNet.Position.x) * direction;
            if (forward < 4f || forward > 24f || Mathf.Abs(point.z - goalNet.Position.z) > 18f) return false;
            float ours = Arrival(Player, point);
            foreach (var p in opponents)
                if (p.PlayerController.IsPhysicsEnabled && Arrival(p, point) < ours + (active ? 0.15f : 0.35f)) return false;
            foreach (var p in teammates)
                if (p != Player && p.PlayerController.IsPhysicsEnabled &&
                    ((p.Position.x - point.x) * direction < -2f || Arrival(p, point) < ours)) return false;
            Player.CurrentAct = Acts.GoingToGetTheBall_BallChasing;
            Player.MoveTo(in deltaTime, point, true);
            return true;
        }
    }
}
