using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// In-match substitution panel for the OpenFoot managed side. Builds its own
/// overlay canvas so the vendor MatchUI prefab stays untouched, and drives the
/// same validation/execution path as the standalone order queue.
/// </summary>
public sealed partial class OpenFootSubstitutionPanel : MonoBehaviour
{
    private static OpenFootSubstitutionPanel installed;

    private static readonly Color32 PanelBackground = new Color32(18, 18, 18, 244);
    private static readonly Color32 RowBackground = new Color32(38, 38, 38, 255);
    private static readonly Color32 RowSelected = new Color32(32, 92, 150, 255);
    private static readonly Color32 RowDisabled = new Color32(26, 26, 26, 160);
    private static readonly Color32 MutedText = new Color32(172, 180, 188, 255);
    private static readonly Color32 Accent = new Color32(47, 143, 214, 255);
    private static readonly Color32 Warning = new Color32(232, 176, 64, 255);
    private static readonly Color32 StyleIdle = new Color32(46, 46, 46, 255);
    private static readonly string[] StyleKeys = { "Balanced", "Attacking", "Defensive", "Counter", "HighPress" };

    private sealed class StyleButton
    {
        public Button Button;
        public Image Image;
        public TMP_Text Label;
        public string Style;
    }

    private sealed class Row
    {
        public GameObject Root;
        public Image Background;
        public Button Button;
        public TMP_Text Label;
        public string Id;
    }

    private OpenFootBridge bridge;
    private OpenFootSubstitutionView view;
    private TMP_FontAsset font;
    private TMP_Text refereeNotice;
    private RectTransform refereeNoticeRoot;
    private readonly List<Row> onPitchRows = new List<Row>();
    private readonly List<Row> substituteRows = new List<Row>();
    private readonly List<Row> roleRows = new List<Row>();
    private bool roleMode;
    private bool tacticsMode;
    private TMP_Text tacticsModeLabel;
    private readonly List<(Button button, TMP_Text label, OpenFootTacticsSettings.Dial dial)> tacticRows
        = new List<(Button, TMP_Text, OpenFootTacticsSettings.Dial)>();
    private readonly List<GameObject> tacticHeadings = new List<GameObject>();
    private OpenFootTacticsSettings.Dial lastTactic;
    private readonly List<StyleButton> styleButtons = new List<StyleButton>();

    private string selectedOff;
    private string selectedOn;
    private bool selectedOffKeeper;
    private string pendingOff;
    private string pendingOn;
    private string pendingOffName;
    private string pendingOnName;
    private string appliedMessage;
    private string errorMessage;
    private int renderedVersion = -1;
    private bool renderedInteractive;
    private int renderedStyleVersion = -1;
    private int renderedFormationVersion = -1;
    private string pendingStyle;
    private string styleMessage;
    private bool styleWarning;
    private bool panelOpen;
    private CursorLockMode previousLock;
    private bool previousCursor;

    private OpenFootLabels.Labels labels => OpenFootLabels.Current;
    private OpenFootLabels.StyleText styleLabels => OpenFootLabels.CurrentStyle;

    /// <summary>Called by OpenFootBridge once the managed lineup is known.</summary>
    public static void Install(OpenFootBridge bridge)
    {
        if (bridge == null) return;
        if (installed != null)
        {
            if (installed.bridge == bridge) return;
            Destroy(installed.gameObject);
        }
        var root = new GameObject("OpenFoot Substitutions");
        DontDestroyOnLoad(root);
        var panel = root.AddComponent<OpenFootSubstitutionPanel>();
        panel.bridge = bridge;
        panel.Build();
        installed = panel;
        bridge.MarkSubstitutionPanelAvailable();
    }

    private void Build()
    {
        var canvasObject = new GameObject("OpenFoot Substitution Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvasObject.transform.SetParent(transform, false);
        canvasObject.layer = 5;
        var canvas = canvasObject.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 200;
        var scaler = canvasObject.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1600, 900);
        scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
        scaler.matchWidthOrHeight = 0.5f;

        font = ResolveFont();
        var prefab = Resources.Load<GameObject>("OpenFootSubstitutionPanel");
        var content = prefab != null
            ? Instantiate(prefab, canvasObject.transform, false)
            : BuildHierarchy(canvasObject.transform, font);
        if (!Bind(content))
        {
            // A prefab from an older build (or from another project's GUIDs)
            // may lack the panel components; rebuild it from code.
            Destroy(content);
            content = BuildHierarchy(canvasObject.transform, font);
            if (!Bind(content)) throw new MissingComponentException("OpenFootSubstitutionView");
        }
        content.name = "OpenFootSubstitutionUI";
        BuildTacticsControls();
        BuildFormationControls();
        view.Panel.SetActive(false);
        OpenFootLabels.Apply(view, labels);
        refereeNoticeRoot = NewRect("Referee Notice", canvasObject.transform);
        refereeNoticeRoot.anchorMin = refereeNoticeRoot.anchorMax = new Vector2(0.5f, 0f);
        refereeNoticeRoot.anchoredPosition = new Vector2(0f, 104f);
        refereeNoticeRoot.sizeDelta = new Vector2(470f, 46f);
        var noticeBackground = refereeNoticeRoot.gameObject.AddComponent<Image>();
        noticeBackground.color = RowBackground;
        noticeBackground.raycastTarget = false;
        refereeNotice = NewText("Decision", refereeNoticeRoot, font, 23f, TextAlignmentOptions.Center, Color.white);
        refereeNotice.richText = false;
        refereeNotice.overflowMode = TextOverflowModes.Ellipsis;
        Stretch(refereeNotice.rectTransform, 12f, 0f, 12f, 0f);
        refereeNoticeRoot.gameObject.SetActive(false);
        Refresh();
    }

    private bool Bind(GameObject content)
    {
        view = content.GetComponent<OpenFootSubstitutionView>();
        if (view == null || view.FormationStatus == null || view.Formation442 == null || view.Formation433 == null
            || view.RolesButton == null || view.RolesLabel == null)
            return false;

        view.OpenButton.onClick.AddListener(Toggle);
        view.CloseButton.onClick.AddListener(Close);
        view.CancelButton.onClick.AddListener(ClearSelection);
        view.ConfirmButton.onClick.AddListener(Confirm);
        view.RolesButton.onClick.AddListener(() => {
            roleMode = formationMode || tacticsMode || !roleMode;
            formationMode = false;
            tacticsMode = false;
            selectedOn = null;
            Refresh();
        });

        styleButtons.Clear();
        var row = content.transform.Find("Panel/StyleRow");
        if (row == null) return false;
        foreach (var key in StyleKeys)
        {
            var item = row.Find(key);
            if (item == null) return false;
            var button = item.GetComponent<Button>();
            if (button == null) return false;
            var label = item.GetComponentInChildren<TMP_Text>();
            string style = key;
            button.onClick.AddListener(() => OnStyleClicked(style));
            styleButtons.Add(new StyleButton
            {
                Button = button,
                Image = item.GetComponent<Image>(),
                Label = label,
                Style = style,
            });
        }
        return styleButtons.Count == StyleKeys.Length;
    }

    private static TMP_FontAsset ResolveFont()
    {
        var sample = FindObjectOfType<TMP_Text>();
        if (sample != null && sample.font != null) return sample.font;
        return TMP_Settings.defaultFontAsset;
    }

    private void Update()
    {
        if (bridge == null) return;
        if (refereeNoticeRoot != null)
        {
            var notice = bridge.RefereeNotice;
            refereeNoticeRoot.gameObject.SetActive(bridge.ResultJson == null && !panelOpen && notice != null);
            refereeNotice.text = notice;
        }
        if (panelOpen)
        {
            // The template can hide or lock the cursor during play; the panel
            // needs a free pointer for as long as it is open.
            if (Cursor.lockState != CursorLockMode.None) Cursor.lockState = CursorLockMode.None;
            if (!Cursor.visible) Cursor.visible = true;
        }
        if (bridge.ResultJson != null)
        {
            if (view != null && view.Root.activeSelf) Close();
            if (view != null) view.Hud.SetActive(false);
            return;
        }
        if (view == null) return;
        view.Hud.SetActive(bridge.CanChangeStyle);
        if (!bridge.CanChangeStyle) return;

        if (bridge.LineupVersion != renderedVersion) Refresh();
        if (bridge.CanChangeStyle != renderedInteractive) Refresh();
        if (bridge.FormationVersion != renderedFormationVersion) Refresh();
        if (bridge.StyleVersion != renderedStyleVersion)
        {
            styleMessage = null;
            styleWarning = false;
            Refresh();
        }
        ProcessStyleOrder();
        if (pendingOff == null) return;

        if (!bridge.CanSubstitute)
        {
            SetStatus(Warning, string.Format(labels.PendingFormat, pendingOffName, pendingOnName));
            return;
        }
        if (bridge.TrySubstitute(pendingOff, pendingOn, out int minute, out string error))
        {
            appliedMessage = string.Format(labels.AppliedFormat, pendingOnName, pendingOffName, minute);
            pendingOff = pendingOn = null;
            selectedOff = selectedOn = null;
            errorMessage = null;
            Refresh();
            SetStatus(Accent, appliedMessage);
            return;
        }
        if (error == "waiting") return;
        pendingOff = pendingOn = null;
        errorMessage = ErrorText(error);
        Refresh();
        SetStatus(Warning, errorMessage);
    }

    /// <summary>
    /// A style order stays pending for one frame: Unity owns the acknowledgement
    /// and only then does the panel show the applied minute.
    /// </summary>
    private void ProcessStyleOrder()
    {
        if (pendingStyle == null) return;
        if (pendingOff != null)
        {
            pendingStyle = null;
            styleMessage = styleLabels.Blocked;
            styleWarning = true;
            Refresh();
            return;
        }
        if (bridge.TryChangeStyle(pendingStyle, out int minute, out string error))
        {
            styleMessage = string.Format(styleLabels.AppliedFormat, StyleName(pendingStyle), minute);
            styleWarning = false;
            pendingStyle = null;
            Refresh();
            return;
        }
        if (error == "same") styleMessage = styleLabels.Same;
        else if (error == "closed") styleMessage = labels.Closed;
        else styleMessage = styleLabels.Blocked;
        styleWarning = true;
        pendingStyle = null;
        Refresh();
    }

    // ------------------------------------------------------------------ actions

    private void Toggle()
    {
        if (view.Panel.activeSelf) Close();
        else OpenPanel();
    }

    private void OpenPanel()
    {
        previousCursor = Cursor.visible;
        previousLock = Cursor.lockState;
        Cursor.visible = true;
        Cursor.lockState = CursorLockMode.None;
        panelOpen = true;
        view.Panel.SetActive(true);
        SelectOff(null, false);
        Refresh();
    }

    private void Close()
    {
        view.Panel.SetActive(false);
        if (!panelOpen) return;
        panelOpen = false;
        Cursor.visible = previousCursor;
        Cursor.lockState = previousLock;
    }

    private void ClearSelection()
    {
        if (formationMode)
        {
            CloseFormationDraft();
            Refresh();
            return;
        }
        SelectOff(null, false);
        selectedOn = null;
        errorMessage = null;
        if (pendingOff == null) appliedMessage = null;
        Refresh();
    }

    private void Confirm()
    {
        if (OrderPending) return;
        if (formationMode)
        {
            ConfirmFormation();
            return;
        }
        if (string.IsNullOrEmpty(selectedOff) || string.IsNullOrEmpty(selectedOn)) return;
        if (!bridge.CheckSubstitution(selectedOff, selectedOn, out string error))
        {
            errorMessage = ErrorText(error);
            Refresh();
            SetStatus(Warning, errorMessage);
            return;
        }
        pendingOff = selectedOff;
        pendingOn = selectedOn;
        var outgoing = FindPlayer(bridge.Lineup, pendingOff);
        var incoming = FindPlayer(bridge.Substitutes, pendingOn);
        pendingOffName = outgoing != null ? outgoing.Name : pendingOff;
        pendingOnName = incoming != null ? incoming.Name : pendingOn;
        errorMessage = null;
        appliedMessage = null;
        SetStatus(Warning, string.Format(labels.PendingFormat, pendingOffName, pendingOnName));
        Refresh();
    }

    private void OnStyleClicked(string style)
    {
        if (bridge == null || !bridge.CanChangeStyle || pendingStyle != null) return;
        if (pendingOff != null || bridge.FormationPending)
        {
            styleMessage = styleLabels.Blocked;
            styleWarning = true;
            Refresh();
            return;
        }
        if (style == bridge.ActivePlayStyle)
        {
            styleMessage = styleLabels.Same;
            styleWarning = true;
            Refresh();
            return;
        }
        pendingStyle = style;
        styleMessage = string.Format(styleLabels.PendingFormat, StyleName(style));
        styleWarning = false;
        Refresh();
    }

    private bool OrderPending => pendingOff != null || pendingStyle != null || bridge.FormationPending;

    private string StyleName(string style)
    {
        switch (style)
        {
            case "Attacking": return styleLabels.Attacking;
            case "Defensive": return styleLabels.Defensive;
            case "Counter": return styleLabels.Counter;
            case "HighPress": return styleLabels.HighPress;
            case "Possession": return OpenFootRoleLabels.Tactic("Possession");
            default: return styleLabels.Balanced;
        }
    }

    private void SelectOff(string id, bool keeper)
    {
        selectedOff = id;
        selectedOffKeeper = keeper;
        if (selectedOn != null)
        {
            var incoming = FindPlayer(bridge.Substitutes, selectedOn);
            if (incoming == null || incoming.Keeper != keeper) selectedOn = null;
        }
        errorMessage = null;
    }

    // -------------------------------------------------------------------- build

    public static GameObject BuildHierarchy(Transform parent, TMP_FontAsset font)
    {
        var root = NewRect("OpenFootSubstitutionUI", parent);
        Stretch(root);

        var view = root.gameObject.AddComponent<OpenFootSubstitutionView>();
        view.Root = root.gameObject;

        // HUD button, bottom right, clear of the template scoreboard (top left).
        var hud = NewRect("Hud", root);
        hud.anchorMin = hud.anchorMax = new Vector2(1f, 0f);
        hud.pivot = new Vector2(1f, 0f);
        hud.anchoredPosition = new Vector2(-28f, 28f);
        hud.sizeDelta = new Vector2(268f, 60f);
        var hudImage = hud.gameObject.AddComponent<Image>();
        hudImage.color = Accent;
        var hudButton = hud.gameObject.AddComponent<Button>();
        hudButton.targetGraphic = hudImage;
        var hudLabel = NewText("Label", hud, font, 22f, TextAlignmentOptions.Center, Color.white);
        Stretch(hudLabel.rectTransform, 12f, 4f, 12f, 4f);
        view.Hud = hud.gameObject;
        view.OpenButton = hudButton;
        view.OpenLabel = hudLabel;

        // Panel card.
        var panel = NewRect("Panel", root);
        panel.anchorMin = panel.anchorMax = new Vector2(1f, 0f);
        panel.pivot = new Vector2(1f, 0f);
        panel.anchoredPosition = new Vector2(-28f, 100f);
        panel.sizeDelta = new Vector2(780f, 640f);
        var panelImage = panel.gameObject.AddComponent<Image>();
        panelImage.color = PanelBackground;
        panelImage.raycastTarget = false;
        view.Panel = panel.gameObject;

        var header = NewRect("Header", panel);
        header.anchorMin = new Vector2(0f, 1f);
        header.anchorMax = new Vector2(1f, 1f);
        header.pivot = new Vector2(0.5f, 1f);
        header.offsetMin = new Vector2(20f, -58f);
        header.offsetMax = new Vector2(-20f, 0f);

        var title = NewText("Title", header, font, 28f, TextAlignmentOptions.Left, Color.white);
        Stretch(title.rectTransform, 0f, 8f, 64f, 8f);
        title.fontStyle = FontStyles.Bold;
        view.Title = title;

        var closeRect = NewRect("Close", header);
        closeRect.anchorMin = closeRect.anchorMax = new Vector2(1f, 1f);
        closeRect.pivot = new Vector2(1f, 1f);
        closeRect.anchoredPosition = new Vector2(0f, -4f);
        closeRect.sizeDelta = new Vector2(46f, 46f);
        var closeImage = closeRect.gameObject.AddComponent<Image>();
        closeImage.color = new Color32(48, 48, 48, 255);
        var closeButton = closeRect.gameObject.AddComponent<Button>();
        closeButton.targetGraphic = closeImage;
        var closeLabel = NewText("Label", closeRect, font, 26f, TextAlignmentOptions.Center, Color.white);
        Stretch(closeLabel.rectTransform);
        closeLabel.text = "X";
        view.CloseButton = closeButton;

        var remaining = NewText("Remaining", panel, font, 19f, TextAlignmentOptions.Left, MutedText);
        SetTopBand(remaining.rectTransform, 20f, 62f, -20f, 28f);
        view.Remaining = remaining;

        // Play-style selector: status line plus one button per style.
        var styleStatus = NewText("StyleStatus", panel, font, 18f, TextAlignmentOptions.Left, MutedText);
        SetTopBand(styleStatus.rectTransform, 20f, 92f, -20f, 26f);
        view.StyleStatus = styleStatus;

        var styleRow = NewRect("StyleRow", panel);
        styleRow.anchorMin = new Vector2(0f, 1f);
        styleRow.anchorMax = new Vector2(1f, 1f);
        styleRow.pivot = new Vector2(0.5f, 1f);
        styleRow.offsetMin = new Vector2(20f, -158f);
        styleRow.offsetMax = new Vector2(-20f, -120f);
        var styleLayout = styleRow.gameObject.AddComponent<HorizontalLayoutGroup>();
        styleLayout.childControlWidth = true;
        styleLayout.childControlHeight = true;
        styleLayout.childForceExpandWidth = true;
        styleLayout.childForceExpandHeight = true;
        styleLayout.spacing = 10f;
        styleLayout.padding = new RectOffset(0, 0, 0, 0);
        foreach (var key in StyleKeys)
        {
            var styleButton = NewButton(key, styleRow, font, 140f, StyleIdle, out var styleLabel);
            styleLabel.fontSize = 16f;
            styleLabel.enableWordWrapping = false;
            styleLabel.overflowMode = TextOverflowModes.Ellipsis;
        }

        var formationRow = NewRect("FormationRow", panel);
        SetTopBand(formationRow, 20f, 166f, -20f, 40f);
        var formationStatus = NewText("FormationStatus", formationRow, font, 18f, TextAlignmentOptions.Left, MutedText);
        Stretch(formationStatus.rectTransform, 0f, 0f, 220f, 0f);
        view.FormationStatus = formationStatus;
        view.Formation442 = FormationButton("4-4-2", formationRow, font, -110f);
        view.Formation433 = FormationButton("4-3-3", formationRow, font, 0f);

        var onPitchHeader = NewText("OnPitchHeader", panel, font, 20f, TextAlignmentOptions.Left, Color.white);
        ColumnHeader(onPitchHeader.rectTransform, true);
        view.OnPitchHeader = onPitchHeader;

        var benchHeader = NewText("BenchHeader", panel, font, 20f, TextAlignmentOptions.Left, Color.white);
        ColumnHeader(benchHeader.rectTransform, false);
        benchHeader.rectTransform.offsetMax -= new Vector2(152f, 0f);
        view.BenchHeader = benchHeader;

        var modes = NewRect("ListMode", panel);
        ColumnHeader(modes, false);
        var rolesButton = NewButton("Roles", modes, font, 146f, StyleIdle, out var rolesLabel);
        var rolesRect = (RectTransform)rolesButton.transform;
        rolesRect.anchorMin = rolesRect.anchorMax = new Vector2(1f, 0.5f);
        rolesRect.pivot = new Vector2(1f, 0.5f);
        rolesRect.anchoredPosition = Vector2.zero;
        rolesRect.sizeDelta = new Vector2(146f, 32f);
        rolesLabel.enableWordWrapping = false;
        rolesLabel.fontSize = 15f;
        rolesLabel.overflowMode = TextOverflowModes.Ellipsis;
        view.RolesButton = rolesButton;
        view.RolesLabel = rolesLabel;

        view.OnPitchScroll = BuildList("OnPitchList", panel, font, true, out var onPitchContent);
        view.OnPitchContent = onPitchContent;
        view.BenchScroll = BuildList("BenchList", panel, font, false, out var benchContent);
        view.BenchContent = benchContent;

        var footer = NewRect("Footer", panel);
        footer.anchorMin = new Vector2(0f, 0f);
        footer.anchorMax = new Vector2(1f, 0f);
        footer.pivot = new Vector2(0.5f, 0f);
        footer.offsetMin = new Vector2(20f, 16f);
        footer.offsetMax = new Vector2(-20f, 76f);

        var status = NewText("Status", footer, font, 18f, TextAlignmentOptions.Left, MutedText);
        Stretch(status.rectTransform, 0f, 0f, 380f, 0f);
        status.enableWordWrapping = true;
        view.Status = status;

        var confirm = NewButton("Confirm", footer, font, 190f, Accent, out var confirmLabel);
        var confirmRect = (RectTransform)confirm.transform;
        confirmRect.anchorMin = confirmRect.anchorMax = new Vector2(1f, 0.5f);
        confirmRect.pivot = new Vector2(1f, 0.5f);
        confirmRect.anchoredPosition = new Vector2(0f, 0f);
        view.ConfirmButton = confirm;
        view.ConfirmLabel = confirmLabel;

        var cancel = NewButton("Cancel", footer, font, 130f, new Color32(52, 52, 52, 255), out var cancelLabel);
        var cancelRect = (RectTransform)cancel.transform;
        cancelRect.anchorMin = cancelRect.anchorMax = new Vector2(1f, 0.5f);
        cancelRect.pivot = new Vector2(1f, 0.5f);
        cancelRect.anchoredPosition = new Vector2(-202f, 0f);
        view.CancelButton = cancel;
        view.CancelLabel = cancelLabel;

        return root.gameObject;
    }

    private static Button FormationButton(string name, RectTransform row, TMP_FontAsset font, float right)
    {
        var button = NewButton(name, row, font, 100f, StyleIdle, out var label);
        label.text = name;
        var rect = (RectTransform)button.transform;
        rect.anchorMin = rect.anchorMax = new Vector2(1f, 0.5f);
        rect.pivot = new Vector2(1f, 0.5f);
        rect.anchoredPosition = new Vector2(right, 0f);
        return button;
    }

    private static ScrollRect BuildList(string name, RectTransform parent, TMP_FontAsset font, bool left, out RectTransform content)
    {
        var column = NewRect(name, parent);
        if (left)
        {
            column.anchorMin = new Vector2(0f, 0f);
            column.anchorMax = new Vector2(0.5f, 1f);
            column.offsetMin = new Vector2(20f, 92f);
            column.offsetMax = new Vector2(-12f, -246f);
        }
        else
        {
            column.anchorMin = new Vector2(0.5f, 0f);
            column.anchorMax = new Vector2(1f, 1f);
            column.offsetMin = new Vector2(12f, 92f);
            column.offsetMax = new Vector2(-20f, -246f);
        }

        var viewport = NewRect("Viewport", column);
        Stretch(viewport);
        var viewportImage = viewport.gameObject.AddComponent<Image>();
        viewportImage.color = new Color32(10, 10, 10, 120);
        viewportImage.raycastTarget = false;
        viewport.gameObject.AddComponent<RectMask2D>();

        content = NewRect("Content", viewport);
        content.anchorMin = new Vector2(0f, 1f);
        content.anchorMax = new Vector2(1f, 1f);
        content.pivot = new Vector2(0.5f, 1f);
        content.anchoredPosition = Vector2.zero;
        content.sizeDelta = Vector2.zero;
        var layout = content.gameObject.AddComponent<VerticalLayoutGroup>();
        layout.childControlHeight = true;
        layout.childControlWidth = true;
        layout.childForceExpandHeight = false;
        layout.childForceExpandWidth = true;
        layout.spacing = 2f;
        layout.padding = new RectOffset(2, 2, 2, 2);
        var fitter = content.gameObject.AddComponent<ContentSizeFitter>();
        fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        var scroll = column.gameObject.AddComponent<ScrollRect>();
        scroll.viewport = viewport;
        scroll.content = content;
        scroll.horizontal = false;
        scroll.vertical = true;
        scroll.movementType = ScrollRect.MovementType.Clamped;
        scroll.scrollSensitivity = 34f;
        return scroll;
    }

    private static void ColumnHeader(RectTransform rect, bool left)
    {
        if (left)
        {
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(0.5f, 1f);
            rect.offsetMin = new Vector2(20f, -242f);
            rect.offsetMax = new Vector2(-12f, -208f);
        }
        else
        {
            rect.anchorMin = new Vector2(0.5f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.offsetMin = new Vector2(12f, -242f);
            rect.offsetMax = new Vector2(-20f, -208f);
        }
    }

    // ------------------------------------------------------------------ refresh

    private void BuildTacticsControls()
    {
        var header = view.CloseButton.transform.parent;
        var toggle = NewButton("TeamTactics", header, font, 206f, StyleIdle, out tacticsModeLabel);
        var rect = (RectTransform)toggle.transform;
        rect.anchorMin = rect.anchorMax = new Vector2(1f, 0.5f);
        rect.pivot = new Vector2(1f, 0.5f);
        rect.anchoredPosition = new Vector2(-56f, 0f);
        rect.sizeDelta = new Vector2(206f, 34f);
        Stretch(view.Title.rectTransform, 0f, 8f, 275f, 8f);
        toggle.onClick.AddListener(() =>
        {
            tacticsMode = !tacticsMode;
            formationMode = false;
            roleMode = false;
            view.OnPitchScroll.verticalNormalizedPosition = 1f;
            view.BenchScroll.verticalNormalizedPosition = 1f;
            Refresh();
        });
        var styleRow = view.Panel.transform.Find("StyleRow");
        var possession = NewButton("Possession", styleRow, font, 118f, StyleIdle, out var possessionLabel);
        possessionLabel.fontSize = 16f;
        possessionLabel.overflowMode = TextOverflowModes.Ellipsis;
        possession.onClick.AddListener(() => OnStyleClicked("Possession"));
        styleButtons.Add(new StyleButton { Button = possession, Image = possession.image, Label = possessionLabel, Style = "Possession" });

        var dials = OpenFootTacticsSettings.Dials;
        AddTacticsGroup("withBall", view.OnPitchContent, dials, 0, 3);
        AddTacticsGroup("transitions", view.OnPitchContent, dials, 7, 2);
        AddTacticsGroup("withoutBall", view.BenchContent, dials, 3, 4);
    }

    private void AddTacticsGroup(string key, Transform parent, OpenFootTacticsSettings.Dial[] dials, int start, int count)
    {
        var group = NewText(key, parent, font, 17f, TextAlignmentOptions.Left, MutedText);
        group.text = OpenFootRoleLabels.Tactic(key);
        group.gameObject.AddComponent<LayoutElement>().preferredHeight = 28f;
        tacticHeadings.Add(group.gameObject);
        for (int index = start; index < start + count; ++index)
        {
            var dial = dials[index];
            var button = NewButton(dial.Label, parent, font, 200f, RowBackground, out var label);
            button.gameObject.AddComponent<LayoutElement>().preferredHeight = 38f;
            label.fontSize = 16f;
            label.overflowMode = TextOverflowModes.Ellipsis;
            button.onClick.AddListener(() =>
            {
                if (OrderPending || !bridge.TryCycleTactic(dial)) return;
                lastTactic = dial;
                Refresh();
            });
            tacticRows.Add((button, label, dial));
        }
    }

    private string TacticValue(OpenFootTacticsSettings.Dial dial) =>
        OpenFootRoleLabels.Tactic(dial.Label + "_" + dial.Read(bridge.TacticalSettings));

    private void Refresh()
    {
        if (view == null || bridge == null) return;
        renderedVersion = bridge.LineupVersion;
        renderedInteractive = bridge.CanChangeStyle;
        renderedStyleVersion = bridge.StyleVersion;
        renderedFormationVersion = bridge.FormationVersion;

        RefreshStyle();
        RefreshFormation();

        var team = bridge.Lineup;
        bool blocked = OrderPending;
        tacticsModeLabel.text = tacticsMode ? labels.Title : OpenFootRoleLabels.Tactic("phaseBlueprint");
        foreach (var heading in tacticHeadings) heading.SetActive(tacticsMode);
        foreach (var item in tacticRows)
        {
            item.button.gameObject.SetActive(tacticsMode);
            if (!tacticsMode) continue;
            item.label.text = OpenFootRoleLabels.Tactic(item.dial.Label) + "   ·   " + TacticValue(item.dial) + "  ›";
            item.button.interactable = bridge.CanChangeStyle && !blocked;
        }
        EnsureRows(onPitchRows, team.Count, view.OnPitchContent);
        for (int index = 0; index < onPitchRows.Count; index++)
        {
            var row = onPitchRows[index];
            if (formationMode || tacticsMode || index >= team.Count)
            {
                row.Root.SetActive(false);
                continue;
            }
            var player = team[index];
            row.Root.SetActive(true);
            row.Id = player.Id;
            row.Label.text = "#" + player.Number + "  " + player.Position + "  " + player.Name;
            row.Button.interactable = bridge.CanChangeStyle && !blocked;
            row.Background.color = player.Id == selectedOff ? RowSelected : RowBackground;
        }

        var benchPlayers = bridge.Substitutes;
        EnsureRows(substituteRows, benchPlayers.Count, view.BenchContent);
        for (int index = 0; index < substituteRows.Count; index++)
        {
            var row = substituteRows[index];
            if (formationMode || tacticsMode || roleMode || index >= benchPlayers.Count)
            {
                row.Root.SetActive(false);
                continue;
            }
            var player = benchPlayers[index];
            bool eligible = selectedOff == null || player.Keeper == selectedOffKeeper;
            row.Root.SetActive(true);
            row.Id = player.Id;
            row.Label.text = "#" + player.Number + "  " + player.Name;
            row.Button.interactable = bridge.CanChangeStyle && eligible && !blocked;
            row.Background.color = player.Id == selectedOn ? RowSelected
                : eligible ? RowBackground : RowDisabled;
        }

        view.OpenLabel.text = bridge.HasSubstitutes
            ? labels.Button + "  " + bridge.SubstitutionsRemaining + "/" + bridge.SubstitutionLimit
            : OpenFootLabels.CurrentFormation.Label;
        view.OnPitchHeader.text = labels.OnPitch + "  (" + team.Count + ")";
        view.BenchHeader.text = labels.Bench + "  (" + benchPlayers.Count + ")";
        view.RolesLabel.text = roleMode ? labels.Bench : OpenFootRoleLabels.Heading;
        view.Remaining.text = string.Format(labels.RemainingFormat, bridge.SubstitutionsRemaining, bridge.SubstitutionLimit);
        view.ConfirmButton.gameObject.SetActive(!roleMode && !tacticsMode);
        view.CancelButton.gameObject.SetActive(!roleMode && !tacticsMode);
        view.ConfirmButton.interactable = !blocked && selectedOff != null && selectedOn != null
            && bridge.SubstitutionsRemaining > 0;
        view.CancelButton.interactable = selectedOff != null || selectedOn != null || pendingOff != null;

        RefreshFormationEditor();
        if (formationMode)
        {
            foreach (var row in roleRows) row.Root.SetActive(false);
            return;
        }
        if (roleMode)
        {
            RefreshRoleRows(blocked);
            return;
        }
        foreach (var row in roleRows) row.Root.SetActive(false);
        if (tacticsMode)
        {
            view.OnPitchHeader.text = OpenFootRoleLabels.Tactic("phaseBlueprint");
            view.BenchHeader.text = "";
            SetStatus(MutedText, lastTactic == null ? "" :
                OpenFootRoleLabels.Tactic(lastTactic.Label) + " · " + TacticValue(lastTactic) + " · " + bridge.TacticsMinute + "'");
            return;
        }
        if (pendingOff != null)
            SetStatus(Warning, string.Format(labels.PendingFormat, pendingOffName, pendingOnName));
        else if (!string.IsNullOrEmpty(errorMessage))
            SetStatus(Warning, errorMessage);
        else if (!string.IsNullOrEmpty(appliedMessage))
            SetStatus(Accent, appliedMessage);
        else if (selectedOff == null)
            SetStatus(MutedText, labels.SelectOff);
        else if (selectedOn == null)
            SetStatus(MutedText, labels.SelectIn);
        else
        {
            var outgoing = FindPlayer(bridge.Lineup, selectedOff);
            var incoming = FindPlayer(bridge.Substitutes, selectedOn);
            SetStatus(Color.white,
                (outgoing != null ? outgoing.Name : selectedOff) + "  ->  " + (incoming != null ? incoming.Name : selectedOn));
        }
    }

    private void RefreshRoleRows(bool blocked)
    {
        var player = FindPlayer(bridge.Lineup, selectedOff);
        var roles = player == null ? Array.Empty<string>() : OpenFootPlayerRoles.ForPosition(player.Slot);
        view.BenchHeader.text = OpenFootRoleLabels.Heading;
        EnsureRows(roleRows, roles.Count, view.BenchContent);
        for (int index = 0; index < roleRows.Count; index++)
        {
            var row = roleRows[index];
            row.Root.SetActive(index < roles.Count);
            if (index >= roles.Count) continue;
            row.Id = roles[index];
            row.Label.text = OpenFootRoleLabels.Name(row.Id);
            row.Button.interactable = bridge.CanChangeStyle && !blocked && row.Id != player.Role;
            row.Background.color = row.Id == player.Role ? RowSelected : RowBackground;
        }
        SetStatus(MutedText, player == null ? labels.OnPitch + " → " + OpenFootRoleLabels.Heading
            : player.Name + " · " + OpenFootRoleLabels.Name(player.Role));
    }

    private void RefreshStyle()
    {
        if (view == null || view.StyleStatus == null) return;
        bool showPending = pendingStyle != null;
        string text = showPending
            ? string.Format(styleLabels.PendingFormat, StyleName(pendingStyle))
            : !string.IsNullOrEmpty(styleMessage)
                ? styleMessage
                : string.Format(styleLabels.ActiveFormat, StyleName(bridge.ActivePlayStyle), bridge.StyleMinute);
        view.StyleStatus.text = text;
        view.StyleStatus.color = showPending || styleWarning ? Warning : MutedText;

        foreach (var item in styleButtons)
        {
            if (item.Label != null) item.Label.text = StyleName(item.Style);
            if (item.Image != null)
                item.Image.color = item.Style == pendingStyle ? Warning
                    : item.Style == bridge.ActivePlayStyle ? Accent
                    : StyleIdle;
            if (item.Button != null)
                item.Button.interactable = bridge.CanChangeStyle && !OrderPending;
        }
    }

    private void RefreshFormation()
    {
        var text = OpenFootLabels.CurrentFormation;
        var active = bridge.ActiveFormation;
        var pending = bridge.PendingFormation;
        view.FormationStatus.text = bridge.FormationFailed ? text.Failed
            : bridge.FormationPending ? string.Format(text.Pending, pending)
            : bridge.FormationMinute > 0 ? string.Format(text.Applied, active, bridge.FormationMinute)
            : text.Label + " · " + active;
        view.FormationStatus.color = bridge.FormationPending || bridge.FormationFailed ? Warning : MutedText;
    }

    private void EnsureRows(List<Row> rows, int count, RectTransform parent, Action<Row> onClick = null)
    {
        while (rows.Count < count)
        {
            var root = new GameObject("Row", typeof(RectTransform), typeof(Image), typeof(Button));
            var rect = (RectTransform)root.transform;
            rect.SetParent(parent, false);
            var image = root.GetComponent<Image>();
            image.color = RowBackground;
            var button = root.GetComponent<Button>();
            button.targetGraphic = image;
            var element = root.AddComponent<LayoutElement>();
            element.preferredHeight = 32f;

            var label = NewText("Label", rect, font, 18f, TextAlignmentOptions.Left, Color.white);
            Stretch(label.rectTransform, 10f, 2f, 8f, 2f);
            label.enableWordWrapping = false;
            label.overflowMode = TextOverflowModes.Ellipsis;

            var row = new Row { Root = root, Background = image, Button = button, Label = label };
            button.onClick.AddListener(() => (onClick ?? OnRowClicked)(row));
            rows.Add(row);
        }
    }

    private void OnRowClicked(Row row)
    {
        if (bridge == null || pendingOff != null || string.IsNullOrEmpty(row.Id)) return;
        if (roleRows.Contains(row))
        {
            if (roleMode && !OrderPending && row.Button.interactable)
                bridge.TrySetPlayerRole(selectedOff, row.Id);
            return;
        }
        var onPitch = onPitchRows.Contains(row);
        if (onPitch)
        {
            var player = FindPlayer(bridge.Lineup, row.Id);
            if (player == null) return;
            if (selectedOff == player.Id) SelectOff(null, false);
            else
            {
                SelectOff(player.Id, player.Keeper);
                appliedMessage = null;
            }
            Refresh();
            return;
        }
        if (!row.Button.interactable) return;
        selectedOn = row.Id;
        appliedMessage = null;
        Refresh();
    }

    private void SetStatus(Color color, string message)
    {
        if (view == null || view.Status == null) return;
        view.Status.color = color;
        view.Status.text = message;
    }

    private string ErrorText(string error)
    {
        switch (error)
        {
            case "limit": return labels.Limit;
            case "keeper": return labels.Keeper;
            case "closed": return labels.Closed;
            default: return labels.SelectSame;
        }
    }

    // ------------------------------------------------------------------ helpers

    private static OpenFootBridge.LineupPlayer FindPlayer(IReadOnlyList<OpenFootBridge.LineupPlayer> players, string id)
    {
        if (players == null) return null;
        for (int index = 0; index < players.Count; index++)
            if (players[index].Id == id) return players[index];
        return null;
    }

    private static RectTransform NewRect(string name, Transform parent)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var rect = (RectTransform)go.transform;
        rect.SetParent(parent, false);
        rect.localScale = Vector3.one;
        return rect;
    }

    private static void Stretch(RectTransform rect, float left = 0f, float bottom = 0f, float right = 0f, float top = 0f)
    {
        rect.anchorMin = Vector2.zero;
        rect.anchorMax = Vector2.one;
        rect.offsetMin = new Vector2(left, bottom);
        rect.offsetMax = new Vector2(-right, -top);
    }

    private static void SetTopBand(RectTransform rect, float left, float top, float right, float height)
    {
        rect.anchorMin = new Vector2(0f, 1f);
        rect.anchorMax = new Vector2(1f, 1f);
        rect.pivot = new Vector2(0.5f, 1f);
        rect.offsetMin = new Vector2(left, -top - height);
        rect.offsetMax = new Vector2(right, -top);
    }

    private static TMP_Text NewText(string name, Transform parent, TMP_FontAsset font, float size,
        TextAlignmentOptions alignment, Color color)
    {
        var rect = NewRect(name, parent);
        var text = rect.gameObject.AddComponent<TextMeshProUGUI>();
        text.font = font;
        text.fontSize = size;
        text.color = color;
        text.alignment = alignment;
        text.raycastTarget = false;
        text.enableWordWrapping = false;
        return text;
    }

    private static Button NewButton(string name, Transform parent, TMP_FontAsset font, float width, Color color, out TMP_Text label)
    {
        var rect = NewRect(name, parent);
        rect.sizeDelta = new Vector2(width, 46f);
        var image = rect.gameObject.AddComponent<Image>();
        image.color = color;
        var button = rect.gameObject.AddComponent<Button>();
        button.targetGraphic = image;
        label = NewText("Label", rect, font, 19f, TextAlignmentOptions.Center, Color.white);
        Stretch(label.rectTransform, 8f, 2f, 8f, 2f);
        return button;
    }
}

/// <summary>
/// Every label ships in the twelve OpenFoot Manager languages; the panel picks
/// the Unity system language and falls back to English.
/// </summary>
public static class OpenFootLabels
{
    public sealed class Labels
    {
        public string Button, Title, OnPitch, Bench, RemainingFormat, Pending, PendingFormat,
            Applied, AppliedFormat, Error, Limit, Keeper, Closed, SelectSame, SelectOff,
            SelectIn, Selected, Confirm, Cancel;
    }

    private static readonly Dictionary<string, Labels> Table = new Dictionary<string, Labels>
    {
        ["en"] = new Labels
        {
            Button = "Substitutions", Title = "Substitutions", OnPitch = "On the pitch", Bench = "Bench",
            RemainingFormat = "{0} of {1} substitutions left", Pending = "Pending",
            PendingFormat = "{0} on for {1}: waiting for the next stoppage",
            Applied = "Applied", AppliedFormat = "{0} came on for {1} in minute {2}",
            Error = "Cannot substitute", Limit = "No substitutions left",
            Keeper = "A goalkeeper can only replace a goalkeeper",
            Closed = "Substitutions are closed", SelectSame = "Choose two different players",
            SelectOff = "Select the player to take off", SelectIn = "Select a replacement from the bench",
            Selected = "Selected", Confirm = "Confirm substitution", Cancel = "Cancel"
        },
        ["es"] = new Labels
        {
            Button = "Sustituciones", Title = "Sustituciones", OnPitch = "En el campo", Bench = "Banquillo",
            RemainingFormat = "Quedan {0} de {1} cambios", Pending = "Pendiente",
            PendingFormat = "Entra {0} por {1}: esperando la próxima interrupción",
            Applied = "Aplicado", AppliedFormat = "Entra {0} por {1} en el minuto {2}",
            Error = "No se puede cambiar", Limit = "No quedan cambios",
            Keeper = "El portero solo puede ser sustituido por otro portero",
            Closed = "Las sustituciones están cerradas", SelectSame = "Elige dos jugadores distintos",
            SelectOff = "Selecciona el jugador que sale", SelectIn = "Selecciona un jugador del banquillo",
            Selected = "Seleccionado", Confirm = "Confirmar cambio", Cancel = "Cancelar"
        },
        ["fr"] = new Labels
        {
            Button = "Remplacements", Title = "Remplacements", OnPitch = "Sur le terrain", Bench = "Banc",
            RemainingFormat = "{0} remplacements sur {1} restants", Pending = "En attente",
            PendingFormat = "{0} entre à la place de {1} : en attente de la prochaine interruption",
            Applied = "Appliqué", AppliedFormat = "{0} entre à la place de {1} à la {2}e minute",
            Error = "Remplacement impossible", Limit = "Plus de remplacements disponibles",
            Keeper = "Un gardien ne peut remplacer qu'un gardien",
            Closed = "Les remplacements sont fermés", SelectSame = "Choisissez deux joueurs différents",
            SelectOff = "Sélectionnez le joueur à sortir", SelectIn = "Sélectionnez un joueur du banc",
            Selected = "Sélectionné", Confirm = "Confirmer le remplacement", Cancel = "Annuler"
        },
        ["de"] = new Labels
        {
            Button = "Wechsel", Title = "Wechsel", OnPitch = "Auf dem Platz", Bench = "Bank",
            RemainingFormat = "{0} von {1} Wechseln übrig", Pending = "Ausstehend",
            PendingFormat = "{0} für {1}: wartet auf die nächste Unterbrechung",
            Applied = "Ausgeführt", AppliedFormat = "{0} kommt für {1} in Minute {2}",
            Error = "Wechsel nicht möglich", Limit = "Keine Wechsel mehr übrig",
            Keeper = "Ein Torwart kann nur durch einen Torwart ersetzt werden",
            Closed = "Wechsel sind geschlossen", SelectSame = "Wähle zwei verschiedene Spieler",
            SelectOff = "Wähle den Spieler, der geht", SelectIn = "Wähle einen Spieler von der Bank",
            Selected = "Ausgewählt", Confirm = "Wechsel bestätigen", Cancel = "Abbrechen"
        },
        ["it"] = new Labels
        {
            Button = "Sostituzioni", Title = "Sostituzioni", OnPitch = "In campo", Bench = "Panchina",
            RemainingFormat = "Restano {0} sostituzioni su {1}", Pending = "In attesa",
            PendingFormat = "Entra {0} al posto di {1}: in attesa della prossima interruzione",
            Applied = "Applicata", AppliedFormat = "Entra {0} al posto di {1} al minuto {2}",
            Error = "Sostituzione non possibile", Limit = "Nessuna sostituzione disponibile",
            Keeper = "Un portiere può sostituire solo un portiere",
            Closed = "Le sostituzioni sono chiuse", SelectSame = "Scegli due giocatori diversi",
            SelectOff = "Seleziona il giocatore che esce", SelectIn = "Seleziona un giocatore dalla panchina",
            Selected = "Selezionato", Confirm = "Conferma sostituzione", Cancel = "Annulla"
        },
        ["pt"] = new Labels
        {
            Button = "Substituições", Title = "Substituições", OnPitch = "Em campo", Bench = "Banco",
            RemainingFormat = "Restam {0} de {1} substituições", Pending = "Pendente",
            PendingFormat = "Entra {0} para o lugar de {1}: à espera da próxima interrupção",
            Applied = "Aplicada", AppliedFormat = "Entra {0} para o lugar de {1} aos {2} minutos",
            Error = "Substituição indisponível", Limit = "Já não há substituições",
            Keeper = "Um guarda-redes só pode ser substituído por outro guarda-redes",
            Closed = "As substituições estão fechadas", SelectSame = "Escolhe dois jogadores diferentes",
            SelectOff = "Seleciona o jogador que sai", SelectIn = "Seleciona um jogador do banco",
            Selected = "Selecionado", Confirm = "Confirmar substituição", Cancel = "Cancelar"
        },
        ["pt-BR"] = new Labels
        {
            Button = "Substituições", Title = "Substituições", OnPitch = "Em campo", Bench = "Banco",
            RemainingFormat = "Restam {0} de {1} substituições", Pending = "Pendente",
            PendingFormat = "Entra {0} no lugar de {1}: aguardando a próxima parada",
            Applied = "Aplicada", AppliedFormat = "Entra {0} no lugar de {1} aos {2} minutos",
            Error = "Substituição indisponível", Limit = "Não há mais substituições",
            Keeper = "Um goleiro só pode ser substituído por outro goleiro",
            Closed = "As substituições estão encerradas", SelectSame = "Escolha dois jogadores diferentes",
            SelectOff = "Selecione o jogador que sai", SelectIn = "Selecione um jogador do banco",
            Selected = "Selecionado", Confirm = "Confirmar substituição", Cancel = "Cancelar"
        },
        ["ru"] = new Labels
        {
            Button = "Замены", Title = "Замены", OnPitch = "На поле", Bench = "Скамейка",
            RemainingFormat = "Осталось {0} из {1} замен", Pending = "Ожидание",
            PendingFormat = "{0} вместо {1}: ожидание следующей остановки",
            Applied = "Выполнено", AppliedFormat = "{0} вышел вместо {1} на {2}-й минуте",
            Error = "Замена невозможна", Limit = "Замены закончились",
            Keeper = "Вратаря может заменить только вратарь",
            Closed = "Замены закрыты", SelectSame = "Выберите двух разных игроков",
            SelectOff = "Выберите игрока, который уходит", SelectIn = "Выберите игрока со скамейки",
            Selected = "Выбрано", Confirm = "Подтвердить замену", Cancel = "Отмена"
        },
        ["tr"] = new Labels
        {
            Button = "Oyuncu Değişiklikleri", Title = "Oyuncu Değişiklikleri", OnPitch = "Sahada", Bench = "Yedekler",
            RemainingFormat = "{1} değişiklikten {0} hakkın kaldı", Pending = "Beklemede",
            PendingFormat = "{1} çıkıyor, {0} giriyor: bir sonraki duruş bekleniyor",
            Applied = "Uygulandı", AppliedFormat = "{0}, {2}. dakikada {1} yerine girdi",
            Error = "Değişiklik yapılamıyor", Limit = "Değişiklik hakkı kalmadı",
            Keeper = "Kaleci yalnızca başka bir kaleciyle değiştirilebilir",
            Closed = "Oyuncu değişiklikleri kapalı", SelectSame = "İki farklı oyuncu seçin",
            SelectOff = "Çıkacak oyuncuyu seçin", SelectIn = "Yedeklerden bir oyuncu seçin",
            Selected = "Seçildi", Confirm = "Değişikliği onayla", Cancel = "İptal"
        },
        ["cs"] = new Labels
        {
            Button = "Střídání", Title = "Střídání", OnPitch = "Na hřišti", Bench = "Lavička",
            RemainingFormat = "Zbývá {0} z {1} střídání", Pending = "Čeká",
            PendingFormat = "{0} za {1}: čeká se na další přerušení",
            Applied = "Provedeno", AppliedFormat = "{0} nastoupil za {1} v {2}. minutě",
            Error = "Střídání nelze provést", Limit = "Žádné střídání nezbývá",
            Keeper = "Brankáře může nahradit jen brankář",
            Closed = "Střídání je uzavřeno", SelectSame = "Vyberte dva různé hráče",
            SelectOff = "Vyberte hráče, který odejde", SelectIn = "Vyberte hráče z lavičky",
            Selected = "Vybráno", Confirm = "Potvrdit střídání", Cancel = "Zrušit"
        },
        ["id"] = new Labels
        {
            Button = "Pergantian", Title = "Pergantian Pemain", OnPitch = "Di lapangan", Bench = "Bangku cadangan",
            RemainingFormat = "Tersisa {0} dari {1} pergantian", Pending = "Menunggu",
            PendingFormat = "{0} masuk menggantikan {1}: menunggu jeda berikutnya",
            Applied = "Diterapkan", AppliedFormat = "{0} masuk menggantikan {1} pada menit {2}",
            Error = "Pergantian tidak bisa dilakukan", Limit = "Pergantian sudah habis",
            Keeper = "Kiper hanya bisa digantikan oleh kiper",
            Closed = "Pergantian ditutup", SelectSame = "Pilih dua pemain berbeda",
            SelectOff = "Pilih pemain yang keluar", SelectIn = "Pilih pemain dari bangku cadangan",
            Selected = "Dipilih", Confirm = "Konfirmasi pergantian", Cancel = "Batal"
        },
        ["zh-CN"] = new Labels
        {
            Button = "换人", Title = "换人", OnPitch = "场上球员", Bench = "替补席",
            RemainingFormat = "还剩 {0}/{1} 次换人", Pending = "等待中",
            PendingFormat = "{0} 换下 {1}：等待下一次死球",
            Applied = "已执行", AppliedFormat = "第 {2} 分钟，{0} 换下 {1}",
            Error = "无法换人", Limit = "换人次数已用完",
            Keeper = "门将只能由门将替换",
            Closed = "换人已关闭", SelectSame = "请选择两名不同的球员",
            SelectOff = "选择要换下的球员", SelectIn = "从替补席选择球员",
            Selected = "已选择", Confirm = "确认换人", Cancel = "取消"
        }
    };

    public static Labels Current
    {
        get
        {
            var code = SystemLanguageCode();
            return Table.TryGetValue(code, out var labels) ? labels : Table["en"];
        }
    }

    public static string SystemLanguageCode()
    {
        switch (Application.systemLanguage)
        {
            case SystemLanguage.Spanish: return "es";
            case SystemLanguage.French: return "fr";
            case SystemLanguage.German: return "de";
            case SystemLanguage.Italian: return "it";
            case SystemLanguage.Portuguese: return "pt";
            case SystemLanguage.Russian: return "ru";
            case SystemLanguage.Turkish: return "tr";
            case SystemLanguage.Czech: return "cs";
            case SystemLanguage.Indonesian: return "id";
            case SystemLanguage.ChineseSimplified:
            case SystemLanguage.Chinese:
            case SystemLanguage.ChineseTraditional: return "zh-CN";
            default: return "en";
        }
    }

    public static void Apply(OpenFootSubstitutionView view, Labels labels)
    {
        view.Title.text = labels.Title;
        view.ConfirmLabel.text = labels.Confirm;
        view.CancelLabel.text = labels.Cancel;
        view.Status.text = labels.SelectOff;
        view.OpenLabel.text = labels.Button;
    }

    /// <summary>Play-style label set; mirrors the manager's common.playStyles.</summary>
    private static readonly Dictionary<string, (string Label, string Pending, string Applied, string Failed)> Formations
        = new Dictionary<string, (string, string, string, string)>
    {
        { "en", ("Formation", "{0} · next stoppage", "{0} · applied at {1}′", "Could not change formation") },
        { "es", ("Formación", "{0} · próxima interrupción", "{0} · aplicada al minuto {1}", "No se pudo cambiar la formación") },
        { "fr", ("Formation", "{0} · prochain arrêt de jeu", "{0} · appliquée à la {1}e minute", "Impossible de changer la formation") },
        { "de", ("Formation", "{0} · nächste Unterbrechung", "{0} · aktiv ab Minute {1}", "Formation konnte nicht geändert werden") },
        { "it", ("Modulo", "{0} · prossima interruzione", "{0} · applicato al minuto {1}", "Impossibile cambiare modulo") },
        { "pt", ("Formação", "{0} · próxima interrupção", "{0} · aplicada aos {1} minutos", "Não foi possível mudar a formação") },
        { "pt-BR", ("Formação", "{0} · próxima interrupção", "{0} · aplicada aos {1} minutos", "Não foi possível mudar a formação") },
        { "ru", ("Схема", "{0} · при следующей остановке", "{0} · с {1}-й минуты", "Не удалось изменить схему") },
        { "tr", ("Diziliş", "{0} · bir sonraki duraklama", "{0} · {1}. dakikada uygulandı", "Diziliş değiştirilemedi") },
        { "cs", ("Rozestavení", "{0} · při příštím přerušení", "{0} · od {1}. minuty", "Rozestavení se nepodařilo změnit") },
        { "id", ("Formasi", "{0} · saat permainan berhenti", "{0} · diterapkan pada menit {1}", "Formasi gagal diubah") },
        { "zh-CN", ("阵型", "{0} · 下次死球时切换", "{0} · 第 {1} 分钟生效", "无法更改阵型") },
    };

    public static (string Label, string Pending, string Applied, string Failed) CurrentFormation =>
        Formations.TryGetValue(SystemLanguageCode(), out var text) ? text : Formations["en"];

    public sealed class StyleText
    {
        public string Label, ActiveFormat, PendingFormat, AppliedFormat, Same, Blocked,
            Balanced, Attacking, Defensive, Counter, HighPress;
    }

    private static readonly Dictionary<string, StyleText> Styles = new Dictionary<string, StyleText>
    {
        ["en"] = new StyleText
        {
            Label = "Play Style", ActiveFormat = "Style: {0} · minute {1}",
            PendingFormat = "Style: {0} · waiting for confirmation",
            AppliedFormat = "Style {0} applied in minute {1}",
            Same = "That style is already active", Blocked = "Finish the pending substitution first",
            Balanced = "Balanced", Attacking = "Attacking", Defensive = "Defensive",
            Counter = "Counter", HighPress = "High Press"
        },
        ["es"] = new StyleText
        {
            Label = "Estilo de Juego", ActiveFormat = "Estilo: {0} · minuto {1}",
            PendingFormat = "Estilo: {0} · esperando confirmación",
            AppliedFormat = "Estilo {0} aplicado en el minuto {1}",
            Same = "Ese estilo ya está activo", Blocked = "Termina primero la sustitución pendiente",
            Balanced = "Equilibrado", Attacking = "Ofensivo", Defensive = "Defensivo",
            Counter = "Contraataque", HighPress = "Presión Alta"
        },
        ["fr"] = new StyleText
        {
            Label = "Style de jeu", ActiveFormat = "Style : {0} · minute {1}",
            PendingFormat = "Style : {0} · en attente de confirmation",
            AppliedFormat = "Style {0} appliqué à la {1}e minute",
            Same = "Ce style est déjà actif", Blocked = "Terminez d'abord le remplacement en attente",
            Balanced = "Équilibré", Attacking = "Offensif", Defensive = "Défensif",
            Counter = "Contre-Attaque", HighPress = "Pressing Haut"
        },
        ["de"] = new StyleText
        {
            Label = "Spielweise", ActiveFormat = "Stil: {0} · Minute {1}",
            PendingFormat = "Stil: {0} · wartet auf Bestätigung",
            AppliedFormat = "Stil {0} in Minute {1} angewendet",
            Same = "Dieser Stil ist bereits aktiv", Blocked = "Schließe zuerst den ausstehenden Wechsel ab",
            Balanced = "Ausgeglichen", Attacking = "Offensiv", Defensive = "Defensiv",
            Counter = "Konter", HighPress = "Hohes Pressing"
        },
        ["it"] = new StyleText
        {
            Label = "Stile di gioco", ActiveFormat = "Stile: {0} · minuto {1}",
            PendingFormat = "Stile: {0} · in attesa di conferma",
            AppliedFormat = "Stile {0} applicato al minuto {1}",
            Same = "Questo stile è già attivo", Blocked = "Completa prima la sostituzione in attesa",
            Balanced = "Equilibrato", Attacking = "Offensivo", Defensive = "Difensivo",
            Counter = "Contropiede", HighPress = "Pressione alta"
        },
        ["pt"] = new StyleText
        {
            Label = "Estilo de Jogo", ActiveFormat = "Estilo: {0} · minuto {1}",
            PendingFormat = "Estilo: {0} · à espera de confirmação",
            AppliedFormat = "Estilo {0} aplicado aos {1} minutos",
            Same = "Esse estilo já está ativo", Blocked = "Conclui primeiro a substituição pendente",
            Balanced = "Equilibrado", Attacking = "Ofensivo", Defensive = "Defensivo",
            Counter = "Contra-Ataque", HighPress = "Pressão Alta"
        },
        ["pt-BR"] = new StyleText
        {
            Label = "Estilo de Jogo", ActiveFormat = "Estilo: {0} · minuto {1}",
            PendingFormat = "Estilo: {0} · aguardando confirmação",
            AppliedFormat = "Estilo {0} aplicado aos {1} minutos",
            Same = "Esse estilo já está ativo", Blocked = "Conclua primeiro a substituição pendente",
            Balanced = "Equilibrado", Attacking = "Ofensivo", Defensive = "Defensivo",
            Counter = "Contra-ataque", HighPress = "Pressão Alta"
        },
        ["ru"] = new StyleText
        {
            Label = "Стиль игры", ActiveFormat = "Стиль: {0} · минута {1}",
            PendingFormat = "Стиль: {0} · ожидание подтверждения",
            AppliedFormat = "Стиль {0} применён на {1}-й минуте",
            Same = "Этот стиль уже активен", Blocked = "Сначала завершите ожидающую замену",
            Balanced = "Сбалансированный", Attacking = "Атакующий", Defensive = "Оборонительный",
            Counter = "Контратакующий", HighPress = "Высокий прессинг"
        },
        ["tr"] = new StyleText
        {
            Label = "Oyun Stili", ActiveFormat = "Stil: {0} · {1}. dakika",
            PendingFormat = "Stil: {0} · onay bekleniyor",
            AppliedFormat = "{0} stili {1}. dakikada uygulandı",
            Same = "Bu stil zaten aktif", Blocked = "Önce bekleyen oyuncu değişikliğini tamamlayın",
            Balanced = "Dengeli", Attacking = "Hücum", Defensive = "Savunma",
            Counter = "Kontratak", HighPress = "Yüksek Pres"
        },
        ["cs"] = new StyleText
        {
            Label = "Herní styl", ActiveFormat = "Styl: {0} · {1}. minuta",
            PendingFormat = "Styl: {0} · čeká na potvrzení",
            AppliedFormat = "Styl {0} použit v {1}. minutě",
            Same = "Tento styl je již aktivní", Blocked = "Nejprve dokončete čekající střídání",
            Balanced = "Vyvážený", Attacking = "Útočný", Defensive = "Defenzivní",
            Counter = "Protiútoky", HighPress = "Vysoký presink"
        },
        ["id"] = new StyleText
        {
            Label = "Gaya Bermain", ActiveFormat = "Gaya: {0} · menit {1}",
            PendingFormat = "Gaya: {0} · menunggu konfirmasi",
            AppliedFormat = "Gaya {0} diterapkan pada menit {1}",
            Same = "Gaya itu sudah aktif", Blocked = "Selesaikan dulu pergantian yang tertunda",
            Balanced = "Seimbang", Attacking = "Menyerang", Defensive = "Bertahan",
            Counter = "Counter", HighPress = "High Press"
        },
        ["zh-CN"] = new StyleText
        {
            Label = "比赛风格", ActiveFormat = "风格：{0} · 第 {1} 分钟",
            PendingFormat = "风格：{0} · 等待确认",
            AppliedFormat = "{0} 风格已在第 {1} 分钟应用",
            Same = "该风格已处于激活状态", Blocked = "请先完成待处理的换人",
            Balanced = "均衡", Attacking = "进攻", Defensive = "防守",
            Counter = "反击", HighPress = "高位逼抢"
        }
    };

    public static StyleText CurrentStyle
    {
        get
        {
            var code = SystemLanguageCode();
            return Styles.TryGetValue(code, out var style) ? style : Styles["en"];
        }
    }
}
