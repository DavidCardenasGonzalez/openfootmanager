using System;
using System.Collections.Generic;
using System.Linq;
using FStudio.Database;
using FStudio.MatchEngine;
using FStudio.MatchEngine.Statistics;

// Copy the same counters Unity reads for its full-time statistics screen.
[Serializable]
public sealed class OpenFootMatchStatistics
{
    [Serializable]
    public sealed class Team
    {
        public int possession_pct, shots, shots_on_target, passes_attempted, passes_completed, corners, saves;
    }

    [Serializable]
    public sealed class Player
    {
        public string player_id;
        public int shots, shots_on_target, passes_attempted, passes_completed, saves;
        public int condition_end;
    }

    public Team home, away;
    public Player[] players;
    public OpenFootMatchRules.Incident[] incidents;
    public bool condition_tracked;

    public static OpenFootMatchStatistics Capture(MatchManager match, IReadOnlyDictionary<PlayerEntry, string> identities,
        OpenFootMatchRules.Incident[] incidents, Func<PlayerEntry, int> conditionAtEnd, bool conditionTracked)
    {
        var statistics = MatchManager.Statistics;
        var shooting = statistics.shooting;
        var passing = statistics.passing;
        var saves = statistics.saves;
        return new OpenFootMatchStatistics
        {
            home = TeamFor(statistics, match.GameTeam1.TeamId),
            away = TeamFor(statistics, match.GameTeam2.TeamId),
            incidents = incidents,
            condition_tracked = conditionTracked,
            // The bridge retains the identities of substituted players. The
            // unused bench never joins this map.
            players = identities.Select(player => new Player
            {
                player_id = player.Value,
                shots = Count(shooting.PlayerAttempt, player.Key.id),
                shots_on_target = Count(shooting.PlayerAttemptOnTarget, player.Key.id),
                passes_attempted = Count(passing.PlayerPassing, player.Key.id),
                passes_completed = Count(passing.PlayerSuccesfulPasses, player.Key.id),
                saves = Count(saves.PlayerBallSave, player.Key.id),
                condition_end = conditionAtEnd(player.Key),
            }).ToArray(),
        };
    }

    private static Team TeamFor(StatisticsManager statistics, int team) => new Team
    {
        possession_pct = statistics.possesioning.TeamPositioning[team],
        shots = statistics.shooting.Attempts[team],
        shots_on_target = statistics.shooting.AttemptsOnTarget[team],
        passes_attempted = statistics.passing.Passes[team],
        passes_completed = statistics.passing.SuccesfulPasses[team],
        corners = statistics.corners.CornerCount[team],
        saves = statistics.saves.BallSaves[team],
    };

    private static int Count(Dictionary<int, int> counts, int id) =>
        counts.TryGetValue(id, out int value) ? value : 0;
}
