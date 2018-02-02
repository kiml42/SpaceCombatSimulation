using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ColourSetter : MonoBehaviour
{
    public Color Colour;

    // Use this for initialization
    void Start()
    {
        transform.SetColor(Colour);
    }
}
