using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ColourSetter : MonoBehaviour
{
    public Color Colour;
    public int Depth = 1;

    // Use this for initialization
    void Start()
    {
        SetColor(transform, Colour, Depth);
    }

    public void SetColour(Transform transform, float r, float g, float b, float a, int depth = 0)
    {
        var colour = new Color(r, g, b, a);
        SetColor(transform, colour, depth);
    }

    public void SetColor(Transform transform, Color colour, int depth = 0)
    {
        var renderer = transform.GetComponent("Renderer") as Renderer;
        if (renderer != null)
        {
            //Debug.Log("has renderer");
            renderer.material.color = colour;
        }

        if (depth > 0)
        {
            var noChildren = base.transform.childCount;
            if (noChildren > 0)
            {
                for (int i = 0; i < noChildren; i++)
                {
                    var child = base.transform.GetChild(i);
                    if (child != null)
                    {
                        child.SetColor(Colour, --depth);
                    }
                }
            }
        }
    }

}
