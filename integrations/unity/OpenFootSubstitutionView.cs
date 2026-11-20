using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Serialized references shared by the runtime build and the saved prefab.
/// Kept in its own file because Unity binds a MonoBehaviour to the script asset
/// that carries its class name.
/// </summary>
public sealed class OpenFootSubstitutionView : MonoBehaviour
{
    public GameObject Root;
    public GameObject Hud;
    public Button OpenButton;
    public TMP_Text OpenLabel;
    public GameObject Panel;
    public Button CloseButton;
    public Button ConfirmButton;
    public Button CancelButton;
    public TMP_Text Title;
    public TMP_Text Remaining;
    public TMP_Text Status;
    public TMP_Text StyleStatus;
    public TMP_Text FormationStatus;
    public Button Formation442;
    public Button Formation433;
    public Button RolesButton;
    public TMP_Text RolesLabel;
    public TMP_Text OnPitchHeader;
    public TMP_Text BenchHeader;
    public TMP_Text ConfirmLabel;
    public TMP_Text CancelLabel;
    public RectTransform OnPitchContent;
    public RectTransform BenchContent;
    public ScrollRect OnPitchScroll;
    public ScrollRect BenchScroll;
}
