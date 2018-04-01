using Assets.Src.ObjectManagement;
using UnityEngine;

public class ColourSetter : MonoBehaviour
{
    public Color Colour;
    public bool SetInStart = false;

    // Use this for initialization
    void Start()
    {
        if(SetInStart)
            SetColor(transform, Colour);
    }

    public void SetColour(Transform transform, float r, float g, float b, float a)
    {
        var colour = new Color(r, g, b, a);
        SetColor(transform, colour);
    }

    public void SetColor(Transform transform, Color colour)
    {
        //Debug.Log(transform + " Is having its color set");
        Colour = colour;
        var renderers = transform.GetComponentsInChildren<Renderer>();
        foreach(var renderer in renderers)
        {
            if (renderer != null)
            {
                //Debug.Log("has renderer");
                renderer.material.color = colour;
            }
        }
    }
}
