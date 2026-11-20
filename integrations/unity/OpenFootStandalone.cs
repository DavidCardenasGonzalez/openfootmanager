using System;
using System.IO;
using System.Threading.Tasks;
using FStudio.UI.Panels;
using UnityEngine;

public static class OpenFootStandalone
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static async void Launch()
    {
        var args = Environment.GetCommandLineArgs();
        int index = Array.IndexOf(args, "-openfoot-request");
        if (index < 0 || index + 1 >= args.Length)
            return;

        string requestPath = args[index + 1];
        const string suffix = ".request.json";
        if (!requestPath.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
        {
            Application.Quit(1);
            return;
        }
        string stem = requestPath.Substring(0, requestPath.Length - suffix.Length);

        try
        {
            Application.runInBackground = true;
            var host = new GameObject("OpenFoot Match");
            UnityEngine.Object.DontDestroyOnLoad(host);
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            int parent = Array.IndexOf(args, "-parentHWND");
            int bounds = Array.IndexOf(args, "-openfoot-bounds");
            if (parent >= 0 && parent + 1 < args.Length && bounds >= 0 && bounds + 1 < args.Length)
                host.AddComponent<OpenFootPlayerWindow>().Configure(args[parent + 1], args[bounds + 1]);
#endif
            float deadline = Time.realtimeSinceStartup + 60;
            while (UnityEngine.Object.FindObjectOfType<MainMenuPanel>() == null)
            {
                if (Time.realtimeSinceStartup > deadline)
                    throw new TimeoutException("Football Simulator did not initialize.");
                await Task.Yield();
            }

            var bridge = host.AddComponent<OpenFootBridge>();
            await bridge.Begin(File.ReadAllText(requestPath));
            int tacticsArg = Array.IndexOf(args, "-openfoot-tactics");
            var tactics = tacticsArg >= 0 && tacticsArg + 1 < args.Length
                ? new LiveTactics(args[tacticsArg + 1])
                : null;
            while (bridge.ResultJson == null)
            {
                tactics?.Poll(bridge);
                await Task.Yield();
            }

            string temporary = stem + "." + Guid.NewGuid().ToString("N");
            File.WriteAllText(temporary, bridge.ResultJson);
            File.Move(temporary, stem + ".result.json");
        }
        catch (Exception error)
        {
            Debug.LogException(error);
            Application.Quit(1);
        }
    }

    private sealed class LiveTactics
    {
        [Serializable] private sealed class Change
        {
            public string play_style;
            public string player_off_id, player_on_id;
            public int minute;
        }

        private readonly string directory;
        private bool ready;
        private uint sequence = 1;
        private float nextPoll;
        private Change applied;
        private Change order;

        public LiveTactics(string directory) => this.directory = directory;

        public void Poll(OpenFootBridge bridge)
        {
            if (!bridge.CanChangeStyle) return;
            // Check for a restart every frame once a substitution is queued.
            // Reading the command directory can still be throttled.
            if (order == null && Time.realtimeSinceStartup < nextPoll) return;
            nextPoll = Time.realtimeSinceStartup + 0.2f;
            try
            {
                if (!ready)
                {
                    // "panel" tells the manager the in-match panel owns the
                    // substitution controls, so it keeps a single visible one.
                    File.WriteAllText(Path.Combine(directory, "ready"),
                        bridge.SubstitutionPanelAvailable ? "panel" : bridge.HasSubstitutes ? "substitutions" : "");
                    ready = true;
                }
                if (applied == null)
                {
                    if (order == null)
                    {
                        var orderPath = Path.Combine(directory, $"{sequence}.order.json");
                        if (!File.Exists(orderPath)) return;
                        order = JsonUtility.FromJson<Change>(File.ReadAllText(orderPath));
                    }
                    if (!string.IsNullOrEmpty(order.player_on_id))
                    {
                        if (!bridge.CanSubstitute) return;
                        order.minute = bridge.Substitute(order.player_off_id, order.player_on_id);
                    }
                    else
                    {
                        order.minute = bridge.ChangeStyle(order.play_style);
                    }
                    applied = order;
                    order = null;
                }
                // Keep the application minute if publishing has to be retried.
                var ackPath = Path.Combine(directory, $"{sequence}.applied.json");
                File.WriteAllText(ackPath + ".tmp", JsonUtility.ToJson(applied));
                File.Move(ackPath + ".tmp", ackPath);
                applied = null;
                sequence++;
            }
            catch (IOException)
            {
                // A temporary filesystem error should not interrupt the match.
            }
        }
    }
}
