using System;
using System.Collections.Generic;
using System.Linq;
using FStudio.Data;
using TMPro;
using UnityEngine.UI;

public sealed partial class OpenFootSubstitutionPanel
{
    private readonly List<Row> formationChoices = new List<Row>();
    private readonly List<Row> formationSlots = new List<Row>();
    private Button openFormationButton;
    private TMP_Text openFormationLabel;
    private OpenFootFormationDraft formationDraft;
    private int selectedSlot = -1;
    private bool formationMode;

    private void BuildFormationControls()
    {
        var parent = (UnityEngine.RectTransform)view.FormationStatus.transform.parent;
        view.Formation442.gameObject.SetActive(false);
        view.Formation433.gameObject.SetActive(false);
        openFormationButton = FormationButton("FormationOptions", parent, font, 0f);
        var rect = (UnityEngine.RectTransform)openFormationButton.transform;
        rect.sizeDelta = new UnityEngine.Vector2(190f, 34f);
        openFormationLabel = openFormationButton.GetComponentInChildren<TMP_Text>();
        Stretch(view.FormationStatus.rectTransform, 0f, 0f, 204f, 0f);
        openFormationButton.onClick.AddListener(() =>
        {
            if (formationMode) CloseFormationDraft();
            else
            {
                formationMode = true;
                tacticsMode = roleMode = false;
                SelectOff(null, false);
                view.OnPitchScroll.verticalNormalizedPosition = 1f;
                view.BenchScroll.verticalNormalizedPosition = 1f;
            }
            Refresh();
        });
    }

    private void CloseFormationDraft()
    {
        formationMode = false;
        formationDraft = null;
        selectedSlot = -1;
    }

    private void ConfirmFormation()
    {
        if (!bridge.TryQueueFormation(formationDraft))
        {
            Refresh();
            SetStatus(Warning, OpenFootLabels.CurrentFormation.Failed);
            return;
        }
        formationDraft = null;
        selectedSlot = -1;
        Refresh();
    }

    private void RefreshFormationEditor()
    {
        openFormationButton.interactable = bridge.CanChangeStyle;
        openFormationLabel.text = formationMode ? labels.Title : OpenFootLabels.CurrentFormation.Label + "  ›";
        if (!formationMode)
        {
            foreach (var row in formationChoices) row.Root.SetActive(false);
            foreach (var row in formationSlots) row.Root.SetActive(false);
            return;
        }

        bool editable = bridge.CanChangeStyle && !OrderPending;
        if (editable && (formationDraft == null || formationDraft.LineupVersion != bridge.LineupVersion))
        {
            formationDraft = bridge.DraftFormation(bridge.ActiveFormationId);
            selectedSlot = -1;
        }
        var shown = bridge.QueuedFormation ?? formationDraft;
        var formations = bridge.FormationOptions.ToArray();
        EnsureRows(formationChoices, formations.Length, view.OnPitchContent, PickFormation);
        for (int index = 0; index < formations.Length; index++)
        {
            var row = formationChoices[index];
            var formation = formations[index];
            var label = OpenFootBridge.FormationName(formation);
            row.Id = formation.ToString();
            row.Root.name = "FormationChoice_" + label;
            row.Root.SetActive(true);
            row.Label.text = formation == bridge.ActiveFormationId ? label + "  ✓" : label;
            row.Button.interactable = editable;
            row.Background.color = shown?.Formation == formation ? RowSelected : RowBackground;
        }

        int count = shown?.Slots.Count ?? 0;
        EnsureRows(formationSlots, count, view.BenchContent, PickFormationSlot);
        for (int index = 0; index < formationSlots.Count; index++)
        {
            var row = formationSlots[index];
            row.Root.SetActive(index < count);
            if (index >= count) continue;
            var player = shown.Players[index];
            var position = shown.Slots[index];
            string role = bridge.ProjectedRole(player.Id, position);
            row.Id = index.ToString();
            row.Root.name = "FormationSlot_" + index;
            row.Root.GetComponent<LayoutElement>().preferredHeight = 48f;
            row.Label.fontSize = 16f;
            row.Label.text = position.ToString().Replace('_', ' ') + "  ·  #" + player.Number + "  " +
                player.Name + "\n" + OpenFootRoleLabels.Name(role);
            row.Button.interactable = editable && index != 0;
            row.Background.color = index == selectedSlot ? RowSelected : RowBackground;
        }

        view.OnPitchHeader.text = OpenFootLabels.CurrentFormation.Label;
        view.BenchHeader.text = shown == null ? "" : OpenFootBridge.FormationName(shown.Formation);
        view.ConfirmButton.interactable = editable && bridge.CanQueueFormation(formationDraft);
        view.CancelButton.interactable = !bridge.FormationPending;
        SetStatus(MutedText, bridge.FormationPending || shown == null ? "" :
            selectedSlot < 0 ? OpenFootRoleLabels.Tactic("selectForSwap") :
                shown.Players[selectedSlot].Name + "  ↔  " + OpenFootRoleLabels.Tactic("selectForSwap"));
    }

    private void PickFormation(Row row)
    {
        if (!formationMode || OrderPending || !Enum.TryParse(row.Id, out Formations formation)) return;
        formationDraft = bridge.DraftFormation(formation);
        selectedSlot = -1;
        view.BenchScroll.verticalNormalizedPosition = 1f;
        Refresh();
    }

    private void PickFormationSlot(Row row)
    {
        if (!formationMode || OrderPending || formationDraft == null || !row.Button.interactable ||
            !int.TryParse(row.Id, out int slot)) return;
        if (selectedSlot < 0) selectedSlot = slot;
        else
        {
            formationDraft.Swap(selectedSlot, slot);
            selectedSlot = -1;
        }
        Refresh();
    }
}
