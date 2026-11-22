using System;
using System.Linq;
using System.Reflection;
using FStudio.MatchEngine;
using FStudio.MatchEngine.Enums;
using FStudio.MatchEngine.Players;
using FStudio.MatchEngine.Players.Behaviours;
using FStudio.MatchEngine.Tactics;
using UnityEngine;

// The wire format matches engine::TacticsConfig. Old match requests can omit it.
[Serializable]
public sealed class OpenFootTacticsSettings
{
    public string build_up_style = "Mixed", width = "Normal", tempo = "Direct";
    public string defensive_line = "Medium", pressing_intensity = "Medium", defensive_shape = "Normal", marking_style = "Zonal";
    public string counter_press_duration = "None", break_speed = "Medium";

    internal sealed class Dial
    {
        public readonly string Label;
        private readonly FieldInfo field;
        public readonly string[] Options;

        public Dial(string fieldName, string label, params string[] options)
        {
            Label = label;
            field = typeof(OpenFootTacticsSettings).GetField(fieldName);
            Options = options;
        }

        public string Read(OpenFootTacticsSettings settings) => (string)field.GetValue(settings);
        public void Write(OpenFootTacticsSettings settings, string value) => field.SetValue(settings, value);
    }

    internal static readonly Dial[] Dials =
    {
        new Dial(nameof(build_up_style), "buildUpStyle", "Short", "Mixed", "Long"),
        new Dial(nameof(width), "width", "Narrow", "Normal", "Wide"),
        new Dial(nameof(tempo), "tempo", "Patient", "Direct"),
        new Dial(nameof(defensive_line), "defensiveLine", "VeryLow", "Low", "Medium", "High"),
        new Dial(nameof(pressing_intensity), "pressingIntensity", "Passive", "Medium", "Aggressive"),
        new Dial(nameof(defensive_shape), "defensiveShape", "Stretched", "Normal", "Compact"),
        new Dial(nameof(marking_style), "markingStyle", "Zonal", "Mixed", "ManToMan"),
        new Dial(nameof(counter_press_duration), "counterPressDuration", "None", "Short", "Long"),
        new Dial(nameof(break_speed), "breakSpeed", "Slow", "Medium", "Fast"),
    };

    internal OpenFootTacticsSettings Normalize()
    {
        var defaults = new OpenFootTacticsSettings();
        foreach (var dial in Dials)
            if (!dial.Options.Contains(dial.Read(this))) dial.Write(this, dial.Read(defaults));
        return this;
    }
}

// TeamTactics and ManagerTactics are shared template assets. Clone both so
// tactical adjustments affect only the managed side, including mirror fixtures.
internal sealed class OpenFootTeamTactics : IDisposable
{
    private static readonly FieldInfo ManagerField = typeof(TeamTactics)
        .GetField("managerTactics", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly FieldInfo ChaseCurve = typeof(BehaviourPreset)
        .GetField("howManyPlayersWillChaseTheBall", BindingFlags.Instance | BindingFlags.NonPublic);
    private readonly GameTeam team;
    private TeamTactics source, instance;
    private ManagerTactics manager;
    private GameTeam lastHolder;
    private float transitionTime;
    private bool counterPress, breaking;
    private AnimationCurve chaseNormal, chaseCounter, joinNormal, joinBreak;
    private BehaviourPreset defending;
    private string style;
    public OpenFootTacticsSettings Settings { get; }

    public OpenFootTeamTactics(GameTeam team, OpenFootTacticsSettings settings, string style)
    {
        this.team = team;
        this.style = style;
        Settings = (settings ?? new OpenFootTacticsSettings()).Normalize();
        SetFormation(team.Team.TeamTactics);
    }

    public void SetFormation(TeamTactics tactics)
    {
        var newInstance = UnityEngine.Object.Instantiate(tactics);
        var newManager = UnityEngine.Object.Instantiate((ManagerTactics)ManagerField.GetValue(tactics));
        ManagerField.SetValue(newInstance, newManager);
        Dispose();
        source = tactics;
        instance = newInstance;
        manager = newManager;
        team.Team.TeamTactics = instance;
        Apply(style);
    }

    public void Apply(string playStyle)
    {
        style = playStyle;
        var type = team.Team.TacticPresetType;
        var originalAttack = source.GetTacticSettings(type, TeamBehaviour.Attacking);
        var attack = instance.GetTacticSettings(type, TeamBehaviour.Attacking);
        // A negative correction spreads the formation even when the stock
        // setting has no compression to remove.
        attack.HorizontalSuppress = Mathf.Clamp(originalAttack.HorizontalSuppress +
            (Settings.width == "Wide" ? -0.19f : Settings.width == "Narrow" ? 0.19f : 0f), -0.25f, 1f);
        attack.StayCloseToBallVertically = Mathf.Clamp01(originalAttack.StayCloseToBallVertically +
            (style == "Possession" ? 0.12f : 0f));
        attack.DefenceAttackSlider = Mathf.Clamp01(originalAttack.DefenceAttackSlider +
            (Settings.tempo == "Patient" ? -0.04f : 0f));

        var originalDefense = source.GetTacticSettings(type, TeamBehaviour.Defending);
        defending = instance.GetTacticSettings(type, TeamBehaviour.Defending);
        float line = Settings.defensive_line == "VeryLow" ? -0.20f :
            Settings.defensive_line == "Low" ? -0.10f : Settings.defensive_line == "High" ? 0.16f : 0f;
        // The base slider can be zero while the ball-progress curve is
        // positive. Apply the bias to the curve and let the engine clamp the sum.
        defending.DefenceAttackSliderAddByBallProgress = line == 0f ? originalDefense.DefenceAttackSliderAddByBallProgress :
            ChangeCurve(originalDefense.DefenceAttackSliderAddByBallProgress, 1f, line, float.MinValue, float.MaxValue);
        float compact = Settings.defensive_shape == "Compact" ? 0.18f :
            Settings.defensive_shape == "Stretched" ? -0.18f : 0f;
        defending.HorizontalSuppress = Mathf.Clamp(originalDefense.HorizontalSuppress + compact, -0.25f, 1f);
        defending.VerticalSuppress = Mathf.Clamp(originalDefense.VerticalSuppress + compact * 0.35f, -0.10f, 1f);
        float marking = Settings.marking_style == "ManToMan" ? 0.32f : Settings.marking_style == "Mixed" ? 0.10f : -0.16f;
        defending.MarkOpponentByBallProgress = ChangeCurve(originalDefense.MarkOpponentByBallProgress, 1f, marking, 0f, 1f);

        float press = Settings.pressing_intensity == "Aggressive" ? 1f : Settings.pressing_intensity == "Passive" ? -1f : 0f;
        var nativeChase = (AnimationCurve)ChaseCurve.GetValue(originalDefense);
        chaseNormal = press == 0f ? nativeChase : ChangeCurve(nativeChase, 1f, press, 1f, 4f);
        chaseCounter = ChangeCurve(nativeChase, 1f, press + 1f, 1f, 4f);
        joinNormal = source.JoinAttackPowerByFieldProgressCurve;
        float breakPower = Settings.break_speed == "Fast" ? 1.3f : Settings.break_speed == "Slow" ? 0.72f : 1f;
        joinBreak = ChangeCurve(joinNormal, breakPower, 0f, 0f, float.MaxValue);
        ApplyTransition();
    }

    private static AnimationCurve ChangeCurve(AnimationCurve source, float scale, float delta, float min, float max)
    {
        var keys = source.keys;
        for (int index = 0; index < keys.Length; ++index)
        {
            var key = keys[index];
            key.value = Mathf.Clamp(key.value * scale + delta, min, max);
            key.inTangent *= scale;
            key.outTangent *= scale;
            keys[index] = key;
        }
        return new AnimationCurve(keys) { preWrapMode = source.preWrapMode, postWrapMode = source.postWrapMode };
    }

    public void Tick(GameTeam holder, bool playing, float now)
    {
        // A loose ball doesn't change possession. A stoppage ends the transition.
        if (!playing)
        {
            lastHolder = null;
            transitionTime = float.NegativeInfinity;
        }
        else if (holder != null && lastHolder != holder)
        {
            transitionTime = lastHolder == null ? float.NegativeInfinity : now;
            lastHolder = holder;
        }

        float since = now - transitionTime;
        float pressWindow = Settings.counter_press_duration == "Long" ? 10f :
            Settings.counter_press_duration == "Short" ? 5f : 0f;
        bool press = playing && lastHolder != null && lastHolder != team && since < pressWindow;
        bool fastBreak = playing && lastHolder == team && since < 5f;
        if (counterPress == press && breaking == fastBreak) return;
        counterPress = press;
        breaking = fastBreak;
        ApplyTransition();
    }

    private void ApplyTransition()
    {
        ChaseCurve.SetValue(defending, counterPress ? chaseCounter : chaseNormal);
        instance.JoinAttackPowerByFieldProgressCurve = breaking ? joinBreak : joinNormal;
    }

    public void Dispose()
    {
        if (instance != null) UnityEngine.Object.Destroy(instance);
        if (manager != null) UnityEngine.Object.Destroy(manager);
    }

    public PlayerBase.PassTarget PreferredPass(PlayerBase player, PlayerBase[] teammates, Vector3 goal, float direction)
    {
        var buildUp = Settings.build_up_style == "Mixed" && style == "Possession" ? "Short" : Settings.build_up_style;
        bool fastBreak = breaking && Settings.break_speed == "Fast";
        bool slow = Settings.tempo == "Patient" || (breaking && Settings.break_speed == "Slow");
        if (buildUp == "Mixed" && !fastBreak && !slow) return default;
        var options = player.AvailablePassTargets(teammates.Where(p => p != player && !p.IsGK), goal);
        if (options == null) return default;

        // Native candidates already account for blocked lanes and offside.
        foreach (var option in options)
        {
            var pass = option.Item1;
            var offset = pass.position - player.Position;
            float depth = offset.x * direction;
            float distance = offset.magnitude;
            bool shortPass = pass.passType == PlayerBase.PassType.ShortPass;
            if (buildUp == "Long" && !fastBreak)
            {
                if (shortPass || distance < 22f || depth < 12f) continue;
            }
            else if (fastBreak)
            {
                if (depth < 9f || (buildUp == "Short" && (!shortPass || distance > 24f))) continue;
            }
            else if (!shortPass || distance > 22f || depth < -10f) continue;

            var settings = EngineSettings.Current;
            float angle = Mathf.Abs(Vector3.SignedAngle(pass.actualTarget.Position - player.Position, offset, Vector3.up));
            float power = settings.PassPowerByPassAngleCurve.Evaluate(angle) *
                settings.PassPowerByAngledPassDistanceCurve.Evaluate(distance);
            return new PlayerBase.PassTarget(pass.passType, pass.optionName, pass.position, pass.actualTarget, power);
        }
        return default;
    }

    internal sealed class PassDecision : BaseBehaviour
    {
        private readonly OpenFootTeamTactics tactics;
        private PlayerBase.PassTarget target;
        public PassDecision(OpenFootTeamTactics tactics) => this.tactics = tactics;

        public override bool Behave(bool isAlreadyActive)
        {
            if (isInputControlled || matchStatus != MatchStatus.Playing || ball.HolderPlayer != Player ||
                Player.GameTeam.BallProgress < 0.12f || Player.GameTeam.BallProgress > 0.73f) return false;
            if (!isAlreadyActive || !target.IsValid || target._ActualTarget.IsInOffside)
                target = tactics.PreferredPass(Player, teammates, targetGoalNet.Position, goalNet.Direction.x);
            if (!target.IsValid) return false;
            Player.CurrentAct = Acts.PassingToBetterOpportunity;
            Player.GameTeam.KeepPlayerBehavioursForAShortTime();
            Player.Stop(in deltaTime);
            var offset = target._Position - Player.Position;
            if (!Player.LookTo(in deltaTime, offset)) return true;
            Player.PassingTarget = target._ActualTarget;
            if (target._PassType == PlayerBase.PassType.LongPass)
            {
                float addition = EngineSettings.Current.CrossTargetAdditionNormalByDistance.Evaluate(offset.magnitude);
                Player.Cross(target._Position + offset.normalized * addition * target._PassPower);
            }
            else Player.Pass(target._Position, Player.SpeedModForPassing() * target._PassPower);
            return true;
        }
    }
}
