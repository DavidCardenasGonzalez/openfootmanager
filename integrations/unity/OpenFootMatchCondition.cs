using System;
using System.Collections.Generic;
using FStudio.Database;
using FStudio.MatchEngine;
using FStudio.MatchEngine.Players;
using UnityEngine;
using UnityEngine.Rendering;

internal sealed class OpenFootMatchCondition : IDisposable
{
    private const int YellowBelow = 75;
    private const int RedBelow = 50;
    private const float FullMatchWear = 40f;
    private static readonly Color Yellow = new Color32(255, 208, 48, 255);
    private static readonly Color Red = new Color32(255, 55, 69, 255);
    private static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
    private static readonly int Tint = Shader.PropertyToID("_Color");

    private sealed class PlayerCondition
    {
        public float Remaining;
        public float WearPerMinute;
        public int Applied = -1;
        public int MarkerBand = -1;
        public MeshRenderer Marker;
    }

    private readonly Dictionary<PlayerEntry, PlayerCondition> players = new Dictionary<PlayerEntry, PlayerCondition>();
    private readonly MaterialPropertyBlock markerProperties = new MaterialPropertyBlock();
    private Mesh ring;
    private Material markerMaterial;
    private float previousMinute;

    internal void Register(PlayerEntry entry, int condition, int fitness, int stamina)
    {
        var wear = (FullMatchWear / 90f) * (1f - stamina * 0.004f) * (1.25f - fitness * 0.005f);
        players.Add(entry, new PlayerCondition { Remaining = condition, WearPerMinute = wear });
    }

    internal int Remaining(PlayerEntry player) => Mathf.RoundToInt(players[player].Remaining);

    internal void Update(MatchManager match)
    {
        // The native match clock advances only during play. Freeze, replay and
        // restarts therefore leave every player's condition where it was.
        float minute = Mathf.Clamp(match.minutes, previousMinute, OpenFootMatchRules.PeriodEnd);
        float played = minute - previousMinute;
        previousMinute = minute;
        UpdateTeam(match.GameTeam1, played);
        UpdateTeam(match.GameTeam2, played);
    }

    internal void ApplyTo(PlayerBase player) => UpdatePlayer(player, 0f);

    private void UpdateTeam(GameTeam team, float played)
    {
        foreach (var player in team.GamePlayers) UpdatePlayer(player, played);
    }

    internal void Hide(PlayerEntry entry)
    {
        if (!players.TryGetValue(entry, out var state) || state.Marker == null) return;
        UnityEngine.Object.Destroy(state.Marker.gameObject);
        state.Marker = null;
        state.MarkerBand = -1;
    }

    private void UpdatePlayer(PlayerBase player, float played)
    {
        var skills = player.MatchPlayer;
        if (!players.TryGetValue(skills.Player, out var state)) return;
        var velocity = player.Velocity;
        float speed = Mathf.Sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        float effort = Mathf.Lerp(0.68f, 1.40f, Mathf.InverseLerp(0f, 5.7f, speed));
        float goalkeeper = player.IsGK ? 0.50f : 1f;
        state.Remaining = Mathf.Max(0f, state.Remaining - state.WearPerMinute * played * effort * goalkeeper);
        int condition = Mathf.RoundToInt(state.Remaining);
        if (condition != state.Applied)
        {
            skills.ApplyOpenFootCondition(condition / 100f);
            state.Applied = condition;
        }

        int band = condition < RedBelow ? 2 : condition < YellowBelow ? 1 : 0;
        if (band == 0) return;
        if (state.Marker == null) state.Marker = CreateMarker(player);
        var position = player.Position;
        state.Marker.transform.position = new Vector3(position.x, 0.055f, position.z);
        if (band == state.MarkerBand) return;
        var color = band == 1 ? Yellow : Red;
        markerProperties.SetColor(BaseColor, color);
        markerProperties.SetColor(Tint, color);
        state.Marker.SetPropertyBlock(markerProperties);
        state.MarkerBand = band;
    }

    private MeshRenderer CreateMarker(PlayerBase player)
    {
        if (ring == null) ring = CreateRing();
        if (markerMaterial == null)
        {
            var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Sprites/Default");
            markerMaterial = new Material(shader) { name = "OpenFoot condition ring" };
        }
        var owner = player.PlayerController.UnityObject;
        var marker = new GameObject("OpenFoot condition ring", typeof(MeshFilter), typeof(MeshRenderer));
        marker.layer = owner.layer;
        marker.transform.SetParent(owner.transform, true);
        marker.GetComponent<MeshFilter>().sharedMesh = ring;
        var renderer = marker.GetComponent<MeshRenderer>();
        renderer.sharedMaterial = markerMaterial;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        return renderer;
    }

    private static Mesh CreateRing()
    {
        const int segments = 36;
        var vertices = new Vector3[segments * 2];
        var triangles = new int[segments * 6];
        for (int index = 0; index < segments; index++)
        {
            float angle = 2f * Mathf.PI * index / segments;
            var direction = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle));
            int inner = index * 2;
            int next = ((index + 1) % segments) * 2;
            vertices[inner] = direction * 0.59f;
            vertices[inner + 1] = direction * 0.79f;
            int triangle = index * 6;
            triangles[triangle] = inner;
            triangles[triangle + 1] = next + 1;
            triangles[triangle + 2] = inner + 1;
            triangles[triangle + 3] = inner;
            triangles[triangle + 4] = next;
            triangles[triangle + 5] = next + 1;
        }
        var mesh = new Mesh { name = "OpenFoot condition ring", vertices = vertices, triangles = triangles };
        mesh.RecalculateNormals();
        return mesh;
    }

    public void Dispose()
    {
        foreach (var state in players.Values)
            if (state.Marker != null) UnityEngine.Object.Destroy(state.Marker.gameObject);
        UnityEngine.Object.Destroy(ring);
        UnityEngine.Object.Destroy(markerMaterial);
    }
}
