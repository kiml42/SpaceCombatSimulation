using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class MenuItem : MonoBehaviour {
    public Color NormalColour = Color.white;
    public Color HighlightColour = Color.yellow;


	// Use this for initialization
	void Start () {
        transform.SetColor(NormalColour);
	}

    public void OnMouseEnter()
    {
        transform.SetColor(HighlightColour);
    }

    public void OnMouseExit()
    {
        transform.SetColor(NormalColour);
    }

    public void OnMouseUp()
    {
        Debug.Log("MouseUp " + name);
    }
}
