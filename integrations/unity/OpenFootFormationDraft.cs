using System.Collections.Generic;
using System.Linq;
using FStudio.Data;

internal sealed class OpenFootFormationDraft
{
    public readonly Formations Formation;
    public readonly int LineupVersion;
    public readonly IReadOnlyList<Positions> Slots;
    private readonly OpenFootBridge.LineupPlayer[] players;
    public IReadOnlyList<OpenFootBridge.LineupPlayer> Players { get; }

    public OpenFootFormationDraft(Formations formation, int version, Positions[] slots,
        IEnumerable<OpenFootBridge.LineupPlayer> players)
    {
        Formation = formation;
        LineupVersion = version;
        Slots = System.Array.AsReadOnly((Positions[])slots.Clone());
        this.players = players.ToArray();
        Players = System.Array.AsReadOnly(this.players);
    }

    public bool Swap(int first, int second)
    {
        // Slot zero is the goalkeeper in every supported formation.
        if (first == second || first <= 0 || second <= 0 ||
            first >= players.Length || second >= players.Length) return false;
        (players[first], players[second]) = (players[second], players[first]);
        return true;
    }

    public OpenFootFormationDraft Copy() =>
        new OpenFootFormationDraft(Formation, LineupVersion, Slots.ToArray(), players);
}
