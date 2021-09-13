using Assets.Src.ObjectManagement;
using UnityEngine;

public class ColourSetter : MonoBehaviour
{
    [Tooltip("if true, this will use its parent's colour setter's colour instead.")]
    public bool GetColourFromParent = true;

    public Color Colour;

    // Use this for initialization
    void Start()
    {
        if (GetColourFromParent && transform.parent != null)
        {
            var parentColourSetter = transform.parent.GetComponentInParent<ColourSetter>();
            if(parentColourSetter != null)
            {
                Colour = parentColourSetter.Colour;
            }
        }
        transform.SetColor(Colour);
    }
}
