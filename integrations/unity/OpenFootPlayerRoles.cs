using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using FStudio.Data;
using FStudio.MatchEngine.Enums;
using FStudio.MatchEngine.FieldPositions;
using FStudio.MatchEngine.Players;
using FStudio.MatchEngine.Players.Behaviours;
using FStudio.MatchEngine.Tactics;
using UnityEngine;

// Rules are keyed by the live formation slot, while the order belongs to the
// player ID. An incompatible role stays dormant until the player fits it again.
public static partial class OpenFootPlayerRoles
{
    public const string Standard = "Standard";

    private static readonly IReadOnlyList<string> Keeper = Options("BallPlayingKeeper", "SweeperKeeper");
    private static readonly IReadOnlyList<string> DefaultOnly = Options();
    private static readonly IReadOnlyList<string> CentreBack = Options("Stopper", "CoverCB", "BallPlayingCB");
    private static readonly IReadOnlyList<string> FullBack = Options("AttackingFB", "DefensiveFB", "InvertedFB", "WingBack");
    private static readonly IReadOnlyList<string> DefensiveMid = Options("AnchorMan", "BallWinner", "DeepLyingPlaymaker");
    private static readonly IReadOnlyList<string> CentreMid = Options("BoxToBox", "Carrilero", "Mezzala");
    private static readonly IReadOnlyList<string> AttackingMid = Options("AdvancedPlaymaker", "ShadowStriker");
    private static readonly IReadOnlyList<string> Wide = Options("WideForward", "InsideForward", "InvertedWinger");
    private static readonly IReadOnlyList<string> Striker = Options("Poacher", "DeepLyingForward", "PressingForward",
        "TargetMan", "False9", "CompleteForward");

    private static IReadOnlyList<string> Options(params string[] roles) =>
        Array.AsReadOnly(new[] { Standard }.Concat(roles).ToArray());

    public static IReadOnlyList<string> ForPosition(Positions position)
    {
        switch (position)
        {
            case Positions.CB: case Positions.CB_L: case Positions.CB_R: return CentreBack;
            case Positions.LB: case Positions.RB: return FullBack;
            case Positions.DMF: case Positions.DMF_L: case Positions.DMF_R: return DefensiveMid;
            case Positions.CM: case Positions.CM_L: case Positions.CM_R: return CentreMid;
            case Positions.AMF: case Positions.AMF_L: case Positions.AMF_R: return AttackingMid;
            case Positions.LMF: case Positions.RMF: case Positions.LW: case Positions.RW: return Wide;
            case Positions.ST: case Positions.ST_L: case Positions.ST_R: return Striker;
            case Positions.GK: return Keeper;
            default: return DefaultOnly;
        }
    }

    public static string Effective(Positions position, string requested) =>
        requested != Standard && ForPosition(position).Contains(requested) ? requested : Standard;

    internal static void BindTeam(IEnumerable<PlayerBase> players, Func<PlayerBase, string> resolve, OpenFootTeamTactics tactics)
    {
        var movement = new ForwardMovement(resolve);
        foreach (var player in players) Bind(player, resolve, movement, tactics);
    }

    private static void Bind(PlayerBase player, Func<PlayerBase, string> resolve, ForwardMovement movement,
        OpenFootTeamTactics tactics)
    {
        // The vendor caches this list. Keep its original objects, forced actions
        // and ordering. Insert our decisions after set-piece and offside actions.
        var owner = player.IsGK ? player.GetType() : typeof(PlayerBase);
        var field = owner.GetField("m_behaviours", BindingFlags.Instance | BindingFlags.NonPublic);
        if (field == null) throw new MissingFieldException(typeof(PlayerBase).FullName, "m_behaviours");
        var behaviours = player.Behaviours.ToList();
        if (player.IsGK)
        {
            behaviours.Insert(behaviours.FindIndex(b => b is GKGoalKick), new ShortDistribution(resolve, true));
            behaviours.Insert(behaviours.FindIndex(b => b is GKBallHoldStay), new ShortDistribution(resolve, false));
            behaviours.Insert(behaviours.FindIndex(b => b is GKShieldBehaviour), new SweepDecision(resolve));
            field.SetValue(player, behaviours.AsReadOnly());
            return;
        }
        behaviours.Insert(behaviours.FindIndex(b => b is OurGKDegageBehaviour), new OfferKeeperOutlet(resolve));
        int ball = behaviours.FindIndex(b => b is RunForwardWithBallBehaviour);
        behaviours.Insert(ball < 0 ? behaviours.Count : ball, new BallDecision(resolve));
        behaviours.Insert(ball < 0 ? behaviours.Count : ball + 1, new OpenFootTeamTactics.PassDecision(tactics));
        int shape = behaviours.FindIndex(b => b is JoinTheAttackBehaviour || b is BecomeAPassOptionBehaviour
            || b is RunBehindDefenseLineBehaviour || b is AbstractTacticalPositioning);
        behaviours.Insert(shape < 0 ? behaviours.Count : shape, new ShapeDecision(resolve, movement));
        field.SetValue(player, behaviours.AsReadOnly());
    }

    // Positions come from the existing tactic. All offsets are in metres and
    // use the direction of attack, so they also work when the team changes ends.
    public static Vector3 TacticalTarget(string role, Vector3 target, Vector3 ball, bool attack,
        float direction, float length, float width, float slotWidth)
    {
        float depth = 0f;
        float middle = width * 0.5f;
        float touchline = slotWidth < middle ? 2f : width - 2f;
        float halfSpace = Mathf.Lerp(middle, touchline, 0.52f);
        switch (role)
        {
            case "Stopper": if (!attack) depth = 4f; break;
            case "CoverCB": if (!attack) depth = -5f; break;
            case "AttackingFB": if (attack) depth = 7f; break;
            case "DefensiveFB": if (attack) depth = -7f; break;
            case "InvertedFB":
                if (attack) { depth = 3f; target.z = Mathf.Lerp(target.z, middle, 0.55f); }
                break;
            case "WingBack":
                if (attack) { depth = 10f; target.z = Mathf.Lerp(target.z, touchline, 0.45f); }
                break;
            case "AnchorMan":
                depth = attack ? -6f : -3f;
                target.z = Mathf.Lerp(target.z, middle, 0.25f);
                break;
            case "BallWinner":
                if (!attack && Mathf.Abs(ball.x - target.x) <= 14f) target = Vector3.MoveTowards(target, ball, 5f);
                break;
            case "DeepLyingPlaymaker": if (attack) depth = -5f; break;
            case "BoxToBox": depth = attack ? 6f : -4f; break;
            case "Carrilero":
                target.z = Mathf.Lerp(target.z, ball.z < middle ? width * 0.28f : width * 0.72f, 0.55f);
                break;
            case "Mezzala": if (attack) { depth = 5f; target.z = Mathf.Lerp(target.z, halfSpace, 0.65f); } break;
            case "AdvancedPlaymaker": if (attack) { depth = -3f; target.z = Mathf.Lerp(target.z, middle, 0.3f); } break;
            case "ShadowStriker": if (attack) { depth = 8f; target.z = Mathf.Lerp(target.z, middle, 0.45f); } break;
            case "WideForward": if (attack) { depth = 4f; target.z = Mathf.Lerp(target.z, touchline, 0.55f); } break;
            case "InsideForward": if (attack) { depth = 5f; target.z = Mathf.Lerp(target.z, middle, 0.55f); } break;
            case "InvertedWinger": if (attack) { depth = 1f; target.z = Mathf.Lerp(target.z, halfSpace, 0.7f); } break;
            case "Poacher": if (attack) { depth = 7f; target.z = Mathf.Lerp(target.z, middle, 0.55f); } break;
            case "DeepLyingForward": if (attack) { depth = -8f; target.z = Mathf.Lerp(target.z, middle, 0.35f); } break;
            case "PressingForward":
                if (!attack && Vector3.Distance(target, ball) <= 16f) target = Vector3.MoveTowards(target, ball, 7f);
                break;
        }
        return new Vector3(Mathf.Clamp(target.x + depth * direction, 1f, length - 1f), 0f,
            Mathf.Clamp(target.z, 1f, width - 1f));
    }

    private static bool HasShapeBias(string role, bool attack)
    {
        switch (role)
        {
            case Standard: case "BallPlayingCB": return false;
            case "Stopper": case "CoverCB": case "BallWinner": case "PressingForward": return !attack;
            case "AnchorMan": case "BoxToBox": case "Carrilero": return true;
            default: return attack;
        }
    }

    private sealed class ShapeDecision : AbstractTacticalPositioning
    {
        private readonly Func<PlayerBase, string> resolve;
        private readonly ForwardMovement movement;
        private string completeMode;
        private float nextChoice;
        public ShapeDecision(Func<PlayerBase, string> resolve, ForwardMovement movement)
        {
            this.resolve = resolve;
            this.movement = movement;
        }

        public override bool Behave(bool isAlreadyActive)
        {
            if (matchStatus != MatchStatus.Playing || isInputControlled || Player.CaughtInOffside
                || Player.IsInOffside || !IsRoughValidated() || ball.HolderPlayer == null || ball.HolderPlayer == Player) return false;
            bool attack = ball.HolderTeam == Player.GameTeam;
            var role = resolve(Player);
            if (role == "CompleteForward")
            {
                if (!attack) { completeMode = null; role = "PressingForward"; }
                else
                {
                    if (completeMode == null || time >= nextChoice)
                    {
                        bool needsSupport = (Player.Position - ball.HolderPlayer.Position).sqrMagnitude > 23f * 23f
                            && !HasSupport(ball.HolderPlayer, Player, teammates, 14f);
                        completeMode = needsSupport ? "DeepLyingForward" : "Poacher";
                        nextChoice = time + 2f;
                    }
                    role = completeMode;
                }
            }
            if (role == "TargetMan") role = "AdvancedPlaymaker";
            if (attack)
                movement.Update(time, teammates, opponents, ball.HolderPlayer, goalNet.Direction.x, offsideLine);
            bool drops = attack && movement.Nine == Player;
            bool runs = attack && movement.Runner == Player;
            if (role == "False9") role = drops ? "DeepLyingForward" : Standard;
            if (runs) role = "Poacher";
            if (!HasShapeBias(role, attack)) return false;

            var ballPosition = ball.transform.position;
            var normal = Player.GetFieldPosition(attack, teamBehaviour, in fieldEndX, in fieldEndY,
                ballPosition, Player.MarkingTarget, in offsideLine, goalNet, targetGoalNet);
            var formal = FormalPositioning.Current.GetPosition(Player.MatchPlayer.Position);
            float slotWidth = fieldEndY * (goalNet.Direction.x > 0f ? formal.HorizontalPlacement : 1f - formal.HorizontalPlacement);
            var target = TacticalTarget(role, normal, ballPosition, attack, goalNet.Direction.x,
                fieldEndX, fieldEndY, slotWidth);
            if (runs) target.z = Mathf.Lerp(normal.z, movement.Channel, 0.55f);
            if ((target - normal).sqrMagnitude < 0.16f) return false;
            if (attack)
            {
                var offside = PlayerBase.IsPositionOffside(target, targetGoalNet, in offsideLine);
                if (offside.Item1) target.x = Mathf.Clamp(offside.Item2, 1f, fieldEndX - 1f);
            }
            targetPosition = target;
            Player.CurrentAct = Acts.TacticalPositioning;
            Player.MoveTo(in deltaTime, targetPosition, false, RequiredMovementType(Player.Position, targetPosition));
            Player.FocusToBall(in deltaTime, ball);
            return true;
        }

    }

    private sealed class BallDecision : BaseBehaviour
    {
        private readonly Func<PlayerBase, string> resolve;
        private readonly PassingBehaviour pass = new PassingBehaviour(1f);
        private readonly CrossingBehaviour cross = new CrossingBehaviour();
        private readonly ShootingBehaviour shot = new ShootingBehaviour(0.72f, 1f);
        private readonly RunForwardWithBallBehaviour cutInside = new RunForwardWithBallBehaviour(
            0.4f, RunForwardWithBallBehaviour.ForwardCurve.EarlyToGoal,
            RunForwardWithBallBehaviour.BewareMod.Careful, false);
        private BaseBehaviour active;
        private readonly PlayerBase[] preferred = new PlayerBase[1];

        public BallDecision(Func<PlayerBase, string> resolve) => this.resolve = resolve;

        public override bool Behave(bool isAlreadyActive)
        {
            if (matchStatus != MatchStatus.Playing || isInputControlled || ball.HolderPlayer != Player)
            {
                active = null;
                return false;
            }
            BaseBehaviour choice;
            var role = resolve(Player);
            if (TryFeedReference(Player, teammates, opponents, resolve, targetGoalNet.Position,
                in deltaTime, preferred)) return true;
            switch (role)
            {
                case "BallPlayingCB":
                    // Leave emergency clearances to the vendor AI.
                    if (Player.GameTeam.BallProgress < 0.12f) return false;
                    choice = pass; break;
                case "DeepLyingPlaymaker": case "AdvancedPlaymaker": case "DeepLyingForward":
                case "False9": case "TargetMan":
                    choice = pass; break;
                case "CompleteForward":
                    choice = Player.GameTeam.BallProgress > 0.74f ? (BaseBehaviour)shot :
                        NearestDistance(Player.Position, opponents) < 6f ? pass : (BaseBehaviour)cutInside;
                    break;
                case "WingBack": case "WideForward": choice = cross; break;
                case "InsideForward": choice = Player.GameTeam.BallProgress > 0.74f ? (BaseBehaviour)shot : cutInside; break;
                case "InvertedWinger": choice = cutInside; break;
                case "ShadowStriker": case "Poacher": choice = shot; break;
                default: return false;
            }
            choice.SetBehaviour(Player, in isInputControlled, in time, in deltaTime, in fieldEndX,
                in fieldEndY, in matchStatus, in teamBehaviour, in offsideLine, in ourOffsideLine,
                ball, goalNet, targetGoalNet, in teammates, in opponents);
            if (!choice.Behave(isAlreadyActive && active == choice))
            {
                active = null;
                return false;
            }
            active = choice;
            return true;
        }
    }
}

internal static class OpenFootRoleLabels
{
    [Serializable] private sealed class Catalog { public Locale[] locales; }
    [Serializable] private sealed class Locale { public string code, heading; public Entry[] roles, tactics; }
    [Serializable] private sealed class Entry { public string id, text; }

    private static Catalog catalog;
    private static Locale Current()
    {
        if (catalog == null)
        {
            var asset = Resources.Load<TextAsset>("OpenFootRoleLabels");
            if (asset != null) catalog = JsonUtility.FromJson<Catalog>(asset.text);
        }
        var code = OpenFootLabels.SystemLanguageCode();
        return catalog?.locales?.FirstOrDefault(locale => locale.code == code)
            ?? catalog?.locales?.FirstOrDefault(locale => locale.code == "en");
    }

    internal static string Heading => Current()?.heading ?? "Player Roles";
    internal static string Name(string id) =>
        Current()?.roles?.FirstOrDefault(role => role.id == id)?.text ?? id;
    internal static string Tactic(string id) =>
        Current()?.tactics?.FirstOrDefault(entry => entry.id == id)?.text ?? id;
}
