using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;
using Assets.Src.Database;
using System;
using UnityEngine.SceneManagement;
using Assets.Src.Menus;

public abstract class EditBaseConfig : MonoBehaviour {
    protected int _loadedId = -1;
    protected bool _hasLoadedExisting;

    public EditMutationConfig MutationConfig;
    public EditMatchConfig MatchConfig;

    public InputField RunName;
    protected int _generationNumber;
    public InputField MinMatchesPerIndividual;
    public InputField WinnersFromEachGeneration;

    public Button RunButton;
    public Button CoppyButton;
    public Button CancelButton;

    public abstract string EvolutionSceneToLoad { get; }
    public abstract string MainMenuSceneToLoad { get; }
    
    // Use this for initialization
    void Start () {
        Initialise();
        LoadConfigFromDB();
        
        RunButton.onClick.AddListener(delegate () { SaveAndRun(); });
        CoppyButton.onClick.AddListener(delegate () { SaveNewAndRun(); });
        CancelButton.onClick.AddListener(delegate () { ReturnToMainMenu(); });
    }
    
    public abstract void Initialise();

    private void ReturnToMainMenu()
    {
        if (!string.IsNullOrEmpty(MainMenuSceneToLoad))
        {
            SceneManager.LoadScene(MainMenuSceneToLoad);
        }
    }

    protected abstract int SaveConfig();

    private void SaveAndRun()
    {
        _loadedId = SaveConfig();
        ArgumentStore.IdToLoad = _loadedId;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    protected abstract int SaveNewConfig();

    private void SaveNewAndRun()
    {
        _loadedId = SaveNewConfig();

        ArgumentStore.IdToLoad = _loadedId;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    protected abstract BaseEvolutionConfig LoadSpecificConfigFromDb();

    protected void LoadConfigFromDB()
    {
        _hasLoadedExisting = ArgumentStore.IdToLoad.HasValue;
        _loadedId = ArgumentStore.IdToLoad ?? -1;

        var config = LoadSpecificConfigFromDb();
        
        RunName.text = config.RunName;
        MinMatchesPerIndividual.text = config.MinMatchesPerIndividual.ToString();
        WinnersFromEachGeneration.text = config.WinnersFromEachGeneration.ToString();

        _generationNumber = config.GenerationNumber;
        
        MatchConfig.LoadConfig(config.MatchConfig, _hasLoadedExisting);
        MutationConfig.LoadConfig(config.MutationConfig, _hasLoadedExisting);
    }
}
