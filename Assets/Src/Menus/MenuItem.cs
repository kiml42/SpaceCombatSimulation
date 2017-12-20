using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;
using UnityEngine.SceneManagement;
using Assets.Src.Menus;

public class MenuItem : MonoBehaviour {
    public Color NormalColour = Color.white;
    public Color HighlightColour = Color.yellow;
    public MainMenuController MainMenu;

    public bool SetIdToLoad = false;
    public int IdToLoad;

    #region Load Scene
    public string SceneToLoad;
    #endregion

    #region MoveCamera
    public Transform CameraLocation;
    #endregion

    #region quit
    public bool Quit = false;
    #endregion

    // Use this for initialization
    void Start () {
        transform.SetColor(NormalColour);
	}

    public void OnMouseEnter()
    {
        Highlight();
    }

    public void OnMouseExit()
    {
        DeHighlight();
    }

    public void OnMouseUp()
    {
        Activate();
    }

    private void Activate()
    {
        Debug.Log(name + " activated");
        if (Quit)
        {
            #if UNITY_EDITOR
                // Application.Quit() does not work in the editor so
                // UnityEditor.EditorApplication.isPlaying need to be set to false to end the game
                UnityEditor.EditorApplication.isPlaying = false;
            #else
                Application.Quit();
            #endif
            return;
        }

        if (SetIdToLoad)
        {
            ArgumentStore.IdToLoad = IdToLoad;
        }

        if(!string.IsNullOrEmpty(SceneToLoad))
        {
            SceneManager.LoadScene(SceneToLoad);
        }

        if(CameraLocation != null)
        {
            MainMenu.CameraTarget = CameraLocation;
        }
    }

    public void Highlight()
    {
        transform.SetColor(HighlightColour);
    }

    public void DeHighlight()
    {
        transform.SetColor(NormalColour);
    }
}
