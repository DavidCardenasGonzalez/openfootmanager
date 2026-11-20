using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;

public static class OpenFootPlayerBuild
{
    [MenuItem("OpenFoot/Build Windows player")]
    public static void Build()
    {
        string directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "com.sturdyrobot.openfootmanager", "unity-player");
        Directory.CreateDirectory(directory);
        var scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray();
        var report = BuildPipeline.BuildPlayer(scenes, Path.Combine(directory, "OpenFootMatch.exe"),
            BuildTarget.StandaloneWindows64, BuildOptions.None);
        if (report.summary.result != BuildResult.Succeeded)
            throw new InvalidOperationException("OpenFoot player build: " + report.summary.result);
        UnityEngine.Debug.Log("OpenFoot player built at " + report.summary.outputPath);
    }
}
