using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;
using Assets.Src.Database;
using System;
using UnityEngine.SceneManagement;
using Assets.Src.Menus;

public class Edit1v1Config : MonoBehaviour {
    [Tooltip("Set to -ve for new")]
    public int IdToLoad = -1;
    private bool _hasLoadedExisting;

    public EditMutationConfig MutationConfig;
    public EditMatchConfig MatchConfig;

    public InputField RunName;
    public InputField MinMatchesPerIndividual;
    public InputField WinnersFromEachGeneration;
    public int GenerationNumber;
    public InputField SuddenDeathDamage;
    public InputField SuddenDeathReloadTime;

    public Button RunButton;
    public Button CoppyButton;
    public Button CancelButton;
    
    public string EvolutionSceneToLoad = "MainMenu";
    public string MainMenuSceneToLoad = "1v1Evolution";

    private Evolution1v1DatabaseHandler _handler;

    // Use this for initialization
    void Start () {
        _handler = new Evolution1v1DatabaseHandler();

        LoadConfig();
        
        RunButton.onClick.AddListener(delegate () { SaveAndRun(); });
        CoppyButton.onClick.AddListener(delegate () { SaveNewAndRun(); });
        CancelButton.onClick.AddListener(delegate () { ReturnToMainMenu(); });
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
        var config = ReadControlls();

        if (_hasLoadedExisting)
        {
            _handler.UpdateExistingConfig(config);
        } else
        {
            IdToLoad = _handler.SaveConfig(config);
        }

        ArgumentStore.IdToLoad = IdToLoad;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    private void SaveNewAndRun()
    {
        var config = ReadControlls();

        config.GenerationNumber = 0;

        IdToLoad = _handler.SaveConfig(config);

        ArgumentStore.IdToLoad = IdToLoad;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    private Evolution1v1Config ReadControlls()
    {
        var config = new Evolution1v1Config
        {
            MatchConfig = MatchConfig.ReadFromControls(),
            MutationConfig = MutationConfig.ReadFromControls(),

            RunName = RunName.text,
            MinMatchesPerIndividual = int.Parse(MinMatchesPerIndividual.text),
            WinnersFromEachGeneration = int.Parse(WinnersFromEachGeneration.text),
            GenerationNumber = GenerationNumber,
            SuddenDeathDamage = float.Parse(SuddenDeathDamage.text),
            SuddenDeathReloadTime = float.Parse(SuddenDeathReloadTime.text)
        };

        return config;
    }

    private void LoadConfig()
    {
        IdToLoad = ArgumentStore.IdToLoad ?? IdToLoad;
        _hasLoadedExisting = IdToLoad >= 0;
        var loaded = _hasLoadedExisting ? _handler.ReadConfig(IdToLoad) : new Evolution1v1Config();

        Debug.Log(loaded.RunName);

        RunName.text = loaded.RunName;
        MinMatchesPerIndividual.text = loaded.MinMatchesPerIndividual.ToString();
        WinnersFromEachGeneration.text = loaded.WinnersFromEachGeneration.ToString();
        SuddenDeathDamage.text = loaded.SuddenDeathDamage.ToString();
        SuddenDeathReloadTime.text = loaded.SuddenDeathReloadTime.ToString();

        GenerationNumber = loaded.GenerationNumber;
        
        MatchConfig.LoadConfig(loaded.MatchConfig, _hasLoadedExisting);
        MutationConfig.LoadConfig(loaded.MutationConfig, _hasLoadedExisting);
    }
}
