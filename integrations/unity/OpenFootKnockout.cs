using System;
using System.Collections.Generic;
using System.Linq;
using FStudio.MatchEngine;
using FStudio.MatchEngine.Players;
using UnityEngine;
using Random = UnityEngine.Random;

public sealed class OpenFootKnockout
{
    [Serializable]
    public sealed class Kick
    {
        public string side, player_id;
        public bool scored;
    }

    private readonly List<Kick> kicks = new List<Kick>();
    private readonly int[] taken = new int[2];
    private readonly int[] score = new int[2];
    private PlayerBase[][] eligible;
    private int kickingSide;

    public bool Active { get; private set; }
    public bool Decided { get; private set; }
    public string Score => $"{score[0]} – {score[1]}";
    public Kick[] Kicks => kicks.ToArray();

    internal void Start(MatchManager match)
    {
        int teamSize = Math.Min(match.GameTeam1.GamePlayers.Length, match.GameTeam2.GamePlayers.Length);
        eligible = new[] { Lineup(match.GameTeam1), Lineup(match.GameTeam2) };
        kickingSide = Random.Range(0, 2);
        Active = true;

        PlayerBase[] Lineup(GameTeam team) => team.GamePlayers.OrderBy(player => player.IsGK)
            .ThenByDescending(player => player.MatchPlayer.GetShooting()).Take(teamSize).ToArray();
    }

    internal PlayerBase NextTaker => eligible[kickingSide][taken[kickingSide] % eligible[kickingSide].Length];

    internal void Record(string playerId, bool scored)
    {
        kicks.Add(new Kick { side = kickingSide == 0 ? "Home" : "Away", player_id = playerId, scored = scored });
        taken[kickingSide]++;
        if (scored) score[kickingSide]++;
        Decided = Math.Max(taken[0], taken[1]) <= 5
            ? score[0] > score[1] + 5 - taken[1] || score[1] > score[0] + 5 - taken[0]
            : taken[0] == taken[1] && score[0] != score[1];
        kickingSide = 1 - kickingSide;
    }
}
