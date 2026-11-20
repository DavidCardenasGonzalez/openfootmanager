using TMPro;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Rebuilds the designer prefab from the same builder the runtime uses, so the
/// asset in Assets/OpenFootBridge/Resources never drifts from the code.
/// </summary>
public static class OpenFootSubstitutionPrefab
{
    private const string Folder = "Assets/OpenFootBridge/Resources";
    private const string AssetPath = Folder + "/OpenFootSubstitutionPanel.prefab";

    [MenuItem("OpenFoot/Rebuild substitution prefab")]
    public static void Rebuild()
    {
        if (!AssetDatabase.IsValidFolder(Folder))
        {
            if (!AssetDatabase.IsValidFolder("Assets/OpenFootBridge"))
                AssetDatabase.CreateFolder("Assets", "OpenFootBridge");
            AssetDatabase.CreateFolder("Assets/OpenFootBridge", "Resources");
        }

        var host = new GameObject("OpenFootSubstitutionPrefabHost");
        try
        {
            var content = OpenFootSubstitutionPanel.BuildHierarchy(host.transform, TMP_Settings.defaultFontAsset);
            PrefabUtility.SaveAsPrefabAsset(content, AssetPath);
        }
        finally
        {
            Object.DestroyImmediate(host);
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("OpenFoot substitution prefab rebuilt at " + AssetPath);
    }
}
