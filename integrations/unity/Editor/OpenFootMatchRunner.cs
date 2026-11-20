using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using FStudio.UI.Panels;

[InitializeOnLoad]
public static class OpenFootMatchRunner
{
    const string Pending = "OpenFootBridge.pending";
    const string StartScene = "Assets/FootballSimulator/_StartingScene.unity";
    static OpenFootBridge bridge;
    static string resultPath;

    static OpenFootMatchRunner() { EditorApplication.update += Tick; }

    [MenuItem("OpenFoot/Play manager match")]
    static void Choose()
    {
        string file = EditorUtility.OpenFilePanel("OpenFoot Manager",
            Path.Combine(Path.GetTempPath(), "OpenFootMatchBridge"), "json");
        if (!string.IsNullOrEmpty(file)) Queue(file);
    }

    public static void Queue(string file)
    {
        if (!file.EndsWith(".request.json", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected .request.json");
        if (!EditorApplication.isPlaying && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
        SessionState.SetString(Pending, file);
        if (EditorApplication.isPlaying) EditorApplication.isPlaying = false;
    }

    static async void Tick()
    {
        try {
            if (bridge != null && bridge.ResultJson != null && resultPath != null) {
                string tmp = resultPath + "." + Guid.NewGuid().ToString("N");
                File.WriteAllText(tmp, bridge.ResultJson);
                File.Move(tmp, resultPath);
                Debug.Log("OpenFoot result: " + resultPath);
                resultPath = null;
            }
            string file = SessionState.GetString(Pending, "");
            if (file.Length == 0 || EditorApplication.isCompiling ||
                EditorApplication.isPlayingOrWillChangePlaymode != EditorApplication.isPlaying) return;
            if (!EditorApplication.isPlaying) {
                EditorSceneManager.OpenScene(StartScene);
                EditorApplication.isPlaying = true;
                return;
            }
            if (SceneManager.GetActiveScene().name != "DefaultScene" ||
                UnityEngine.Object.FindObjectOfType<MainMenuPanel>() == null) return;
            SessionState.EraseString(Pending);
            resultPath = file.Substring(0,file.Length - ".request.json".Length) + ".result.json";
            if (File.Exists(resultPath)) throw new IOException("Result already exists");
            var root = new GameObject("OpenFoot Match");
            UnityEngine.Object.DontDestroyOnLoad(root);
            bridge = root.AddComponent<OpenFootBridge>();
            await bridge.Begin(File.ReadAllText(file));
        } catch (Exception e) {
            SessionState.EraseString(Pending);
            resultPath = null;
            Debug.LogException(e);
        }
    }
}
