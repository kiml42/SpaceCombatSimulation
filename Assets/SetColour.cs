using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SetColour : MonoBehaviour
{
    public float R = 0.5f;
    public float G = 0.5f;
    public float B = 0.5f;

    // Use this for initialization
    void Start()
    {
        SetColor(transform, 1);
    }

    private void SetColor(Transform transform, int depth = 0)
    {
        var colour = new Color(R, G, B);
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
                        SetColor(child, --depth);
                    }
                }
            }
        }
    }

}
