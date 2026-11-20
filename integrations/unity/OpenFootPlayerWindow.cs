#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

public sealed class OpenFootPlayerWindow : MonoBehaviour
{
    [Serializable]
    private sealed class Bounds
    {
        public int x, y, width, height;
    }

    private delegate bool EnumWindow(IntPtr handle, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr order, int x, int y, int width, int height, uint flags);

    private IntPtr parent, window;
    private uint process;
    private string path, lastBounds;
    private float nextCheck;

    public void Configure(string parentHandle, string boundsPath)
    {
        parent = new IntPtr(long.Parse(parentHandle));
        path = boundsPath;
        using (var current = System.Diagnostics.Process.GetCurrentProcess())
            process = (uint)current.Id;
    }

    private bool FindPlayerWindow(IntPtr candidate, IntPtr unused)
    {
        GetWindowThreadProcessId(candidate, out uint owner);
        if (owner != process)
            return true;

        var name = new StringBuilder(64);
        GetClassName(candidate, name, name.Capacity);
        if (name.ToString() != "UnityWndClass")
            return true;

        window = candidate;
        return false;
    }

    private void Update()
    {
        if (path == null || Time.realtimeSinceStartup < nextCheck)
            return;
        nextCheck = Time.realtimeSinceStartup + 0.25f;

        if (window == IntPtr.Zero)
            EnumChildWindows(parent, FindPlayerWindow, IntPtr.Zero);
        if (window == IntPtr.Zero || !File.Exists(path))
            return;

        try
        {
            string json = File.ReadAllText(path);
            if (json == lastBounds)
                return;
            var bounds = JsonUtility.FromJson<Bounds>(json);
            if (bounds == null || bounds.width < 1 || bounds.height < 1)
                return;
            const uint NoActivate = 0x0010;
            if (SetWindowPos(window, IntPtr.Zero, bounds.x, bounds.y, bounds.width, bounds.height, NoActivate))
            {
                if (lastBounds == null)
                    File.WriteAllText(Path.ChangeExtension(path, "attached"), "");
                lastBounds = json;
            }
        }
        catch (IOException) { }
        catch (ArgumentException) { }
    }
}
#endif
