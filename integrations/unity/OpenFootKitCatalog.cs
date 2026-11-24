using System;
using FStudio.Database;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

public sealed class OpenFootKitCatalog : ScriptableObject
{
    [Serializable]
    public sealed class Kits
    {
        public Kit home, away;
    }

    [Serializable]
    public sealed class Kit
    {
        public string pattern;
        public Colors colors;
        public int unity_mask;
    }

    [Serializable]
    public sealed class Colors
    {
        public string primary, secondary;
    }

    private const int MaskCount = 10;
    private const string ResourceName = "OpenFootKitCatalog";
    [SerializeField] private Texture[] matchMasks;
    [SerializeField] private Texture[] previewMasks;

    public static KitEntry CreateKit(KitEntry template, Kit kit)
    {
        if (template == null || kit?.colors == null ||
            !TryColor(kit.colors.primary, out var primary) ||
            !TryColor(kit.colors.secondary, out var secondary))
            return null;

        int mask = kit.unity_mask >= 1 && kit.unity_mask <= MaskCount
            ? kit.unity_mask : MaskForPattern(kit.pattern);
        if (mask == 0)
        {
            mask = 1;
            secondary = primary;
        }

        var catalog = Resources.Load<OpenFootKitCatalog>(ResourceName);
        Texture matchMask;
        Texture previewMask;
        if (catalog != null)
        {
            matchMask = FindMask(catalog.matchMasks, mask);
            previewMask = FindMask(catalog.previewMasks, mask);
        }
        else
        {
#if UNITY_EDITOR
            matchMask = LoadMask(mask, false);
            previewMask = LoadMask(mask, true);
#else
            return null;
#endif
        }

        if (matchMask == null || previewMask == null) return null;

        var result = Instantiate(template);
        result.KitMaterial = matchMask;
        result.PreviewTexture = previewMask;
        result.Color1 = primary;
        result.Color2 = secondary;
        result.TextColor = primary.grayscale > 0.5f ? Color.black : Color.white;
        return result;
    }

    private static bool TryColor(string hex, out Color color)
    {
        color = default;
        return hex != null && hex.Length == 7 && hex[0] == '#' &&
            ColorUtility.TryParseHtmlString(hex, out color);
    }

    private static int MaskForPattern(string pattern)
    {
        switch (pattern)
        {
            case "Stripes": return 9;
            case "Hoops": return 2;
            case "HalfAndHalf": return 5;
            case "Diagonal": return 6;
            default: return 0;
        }
    }

    private static Texture FindMask(Texture[] masks, int mask) =>
        masks != null && masks.Length >= mask ? masks[mask - 1] : null;

#if UNITY_EDITOR
    private const string PlayerModelPath = "Assets/FootballSimulator/Arts/FootballPlayer/PlayerModel/";

    private static Texture LoadMask(int mask, bool preview) =>
        AssetDatabase.LoadAssetAtPath<Texture>(PlayerModelPath +
            (preview ? "UIKits/" : "Textures/KitSchemas/") + $"KitMask{mask}.png");

    public static void PrepareForBuild()
    {
        var match = new Texture[MaskCount];
        var preview = new Texture[MaskCount];
        for (int i = 0; i < MaskCount; i++)
        {
            match[i] = LoadMask(i + 1, false);
            preview[i] = LoadMask(i + 1, true);
            if (match[i] == null || preview[i] == null)
                throw new InvalidOperationException($"Missing Football Simulator KitMask{i + 1} (3D or UI)");
        }

        const string folder = "Assets/OpenFootBridge/Resources";
        const string path = folder + "/" + ResourceName + ".asset";
        if (!AssetDatabase.IsValidFolder(folder))
            AssetDatabase.CreateFolder("Assets/OpenFootBridge", "Resources");

        var catalog = AssetDatabase.LoadAssetAtPath<OpenFootKitCatalog>(path);
        if (catalog == null)
        {
            catalog = CreateInstance<OpenFootKitCatalog>();
            AssetDatabase.CreateAsset(catalog, path);
        }
        catalog.matchMasks = match;
        catalog.previewMasks = preview;
        EditorUtility.SetDirty(catalog);
        AssetDatabase.SaveAssetIfDirty(catalog);
    }
#endif
}
