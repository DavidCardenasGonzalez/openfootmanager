using FStudio.MatchEngine.Enums;
using FStudio.MatchEngine.Players.Behaviours;
using UnityEngine;

internal static class OpenFootShotSelection
{
    private const float LongShotDistance = 24f;
    internal const float MaximumShotDistance = 34f;
    internal const float ChipKeeperAdvance = 7f;
    internal const float FinishDistance = 16f;
    internal const float CarryLookAhead = 8f;
    private const float CarryHalfWidth = 4f;
    private const float PressureRadius = 4f;
    private const float ClosingTime = 0.75f;

    internal static float DistanceMultiplier(float distance)
    {
        return 1f - Mathf.InverseLerp(LongShotDistance, MaximumShotDistance, distance);
    }

    internal static bool OpponentClosesLane(Vector3 relativePosition, Vector3 velocity, Vector3 direction)
    {
        relativePosition.y = 0;
        velocity.y = 0;
        return Blocks(relativePosition) || Blocks(relativePosition + velocity * ClosingTime);

        bool Blocks(Vector3 offset)
        {
            if (offset.sqrMagnitude <= PressureRadius * PressureRadius)
                return true;

            float ahead = Vector3.Dot(offset, direction);
            var lateral = offset - direction * ahead;
            return ahead > 0 && ahead <= CarryLookAhead &&
                lateral.sqrMagnitude <= CarryHalfWidth * CarryHalfWidth;
        }
    }
}

internal sealed class OpenFootBreakawayBehaviour : BaseBehaviour
{
    public override bool Behave(bool isAlreadyActive)
    {
        if (isInputControlled || (matchStatus & MatchStatus.Playing) == 0 ||
            ball.HolderPlayer != Player || Player.IsGK || Player.PlayerFieldProgress < 0.5f ||
            ball.transform.position.y > 1f)
            return false;

        var position = Player.Position;
        var toGoal = targetGoalNet.Position - position;
        toGoal.y = 0;
        float distance = toGoal.magnitude;
        if (distance <= OpenFootShotSelection.FinishDistance)
            return false;

        var direction = toGoal / distance;
        foreach (var opponent in opponents)
        {
            if (opponent.PlayerController.IsPhysicsEnabled &&
                OpenFootShotSelection.OpponentClosesLane(opponent.Position - position, opponent.Velocity, direction))
                return false;
        }

        Player.CurrentAct = Acts.RunningForward;
        var target = position + direction * OpenFootShotSelection.CarryLookAhead;
        return !Player.MoveTo(in deltaTime, target);
    }
}
