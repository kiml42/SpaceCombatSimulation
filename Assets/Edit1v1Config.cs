using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;
using Assets.Src.Database;
using System;
using UnityEngine.SceneManagement;

public class Edit1v1Config : MonoBehaviour {
    public int IdToLoad;

    public EditMutationConfig MutationConfig;
    public EditMatchConfig MatchConfig;

    public InputField RunName;
    public InputField MinMatchesPerIndividual;
    public InputField WinnersFromEachGeneration;
    public InputField GenerationNumber;
    public InputField SuddenDeathDamage;
    public InputField SuddenDeathReloadTime;

    Button RunButton;
    Button CancelButton;
    
    public string EvolutionSceneToLoad = "MainMenu";
    public string MainMenuSceneToLoad = "1v1Evolution";

    private Evolution1v1DatabaseHandler _handler;

    // Use this for initialization
    void Start () {
        _handler = new Evolution1v1DatabaseHandler();

        LoadConfig();
        
        RunButton.onClick.AddListener(delegate () { SaveAndRun(); });
        RunButton.onClick.AddListener(delegate () { ReturnToMainMenu(); });
    }

    private void ReturnToMainMenu()
    {
        if (!string.IsNullOrEmpty(MainMenuSceneToLoad))
        {
            SceneManager.LoadScene(MainMenuSceneToLoad);
        }
    }

    private void SaveAndRun()
    {
        var config = new Evolution1v1Config();

        config.MatchConfig = MatchConfig.ReadFromControls();
        config.MutationConfig = MutationConfig.ReadFromControls();

        config.RunName = RunName.text;
        config.MinMatchesPerIndividual = int.Parse(MinMatchesPerIndividual.text);
        config.WinnersFromEachGeneration = int.Parse(WinnersFromEachGeneration.text);
        config.GenerationNumber = int.Parse(GenerationNumber.text);
        config.SuddenDeathDamage = float.Parse(SuddenDeathDamage.text);
        config.SuddenDeathReloadTime = float.Parse(SuddenDeathReloadTime.text);

        //if (!string.IsNullOrEmpty(EvolutionSceneToLoad))
        //{
        //    SceneManager.LoadScene(EvolutionSceneToLoad);
        //}
    }

    // Update is called once per frame
    //void Update () {
    //       Debug.Log(RunName.text);
    //}

    private void LoadConfig()
    {
        var loaded = _handler.ReadConfig(IdToLoad);

        Debug.Log(loaded.RunName);

        RunName.text = loaded.RunName;
        MinMatchesPerIndividual.text = loaded.MinMatchesPerIndividual.ToString();
        WinnersFromEachGeneration.text = loaded.WinnersFromEachGeneration.ToString();
        GenerationNumber.text = loaded.GenerationNumber.ToString();
        SuddenDeathDamage.text = loaded.SuddenDeathDamage.ToString();
        SuddenDeathReloadTime.text = loaded.SuddenDeathReloadTime.ToString();

        MatchConfig.LoadConfig(loaded.MatchConfig);
        MutationConfig.LoadConfig(loaded.MutationConfig);
    }
}
