using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;
using Assets.Src.Database;
using System;
using UnityEngine.SceneManagement;
using Assets.Src.Menus;

public class EditDroneConfig : MonoBehaviour {
    private int _loadedId = -1;
    private bool _hasLoadedExisting;

    public EditMutationConfig MutationConfig;
    public EditMatchConfig MatchConfig;

    public InputField RunName;
    private int _generationNumber;
    public InputField MinMatchesPerIndividual;
    public InputField WinnersFromEachGeneration;
    public InputField minDrones;
    public InputField DroneEscalation;
    public InputField MaxDrones;
    public InputField DronesList;

    public InputField ShipInSphereRandomRadius;
    public InputField ShipOnSphereRandomRadius;
    public InputField DronesInSphereRandomRadius;
    public InputField DronesOnSphereRandomRadius;

    public Button RunButton;
    public Button CoppyButton;
    public Button CancelButton;
    
    public string EvolutionSceneToLoad = "TargetEvolution";
    public string MainMenuSceneToLoad = "MainMenu";

    private EvolutionDroneDatabaseHandler _handler;
    private EvolutionDroneConfig _loaded;

    // Use this for initialization
    void Start () {
        _handler = new EvolutionDroneDatabaseHandler();

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
            _loadedId = _handler.SaveNewConfig(config);
        }

        ArgumentStore.IdToLoad = _loadedId;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    private void SaveNewAndRun()
    {
        var config = ReadControlls();

        config.GenerationNumber = 0;

        _loadedId = _handler.SaveNewConfig(config);

        ArgumentStore.IdToLoad = _loadedId;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    private EvolutionDroneConfig ReadControlls()
    {
        _loaded.MatchConfig = MatchConfig.ReadFromControls();
        _loaded.MutationConfig = MutationConfig.ReadFromControls();

        _loaded.RunName = RunName.text;
        _loaded.MinMatchesPerIndividual = int.Parse(MinMatchesPerIndividual.text);
        _loaded.WinnersFromEachGeneration = int.Parse(WinnersFromEachGeneration.text);
        _loaded.GenerationNumber = _generationNumber;
        _loaded.MinDronesToSpawn = int.Parse(minDrones.text);
        _loaded.ExtraDromnesPerGeneration = float.Parse(DroneEscalation.text);
        _loaded.MaxDronesToSpawn = int.Parse(MaxDrones.text);
        _loaded.DronesString = DronesList.text;
        
        _loaded.ShipInSphereRandomRadius = int.Parse(ShipInSphereRandomRadius.text);
        _loaded.ShipOnSphereRandomRadius = int.Parse(ShipOnSphereRandomRadius.text);
        _loaded.DronesInSphereRandomRadius = int.Parse(DronesInSphereRandomRadius.text);
        _loaded.DronesOnSphereRandomRadius = int.Parse(DronesOnSphereRandomRadius.text);

        return _loaded;
    }

    private void LoadConfig()
    {
        _hasLoadedExisting = ArgumentStore.IdToLoad.HasValue;
        _loadedId = ArgumentStore.IdToLoad ?? -1;
        _loaded = _hasLoadedExisting ? _handler.ReadConfig(_loadedId) : new EvolutionDroneConfig();
        
        RunName.text = _loaded.RunName;
        MinMatchesPerIndividual.text = _loaded.MinMatchesPerIndividual.ToString();
        WinnersFromEachGeneration.text = _loaded.WinnersFromEachGeneration.ToString();
        minDrones.text = _loaded.MinDronesToSpawn.ToString();
        DroneEscalation.text = _loaded.ExtraDromnesPerGeneration.ToString();
        MaxDrones.text = _loaded.MaxDronesToSpawn.ToString();
        DronesList.text = _loaded.DronesString.ToString();

        ShipInSphereRandomRadius.text = _loaded.ShipInSphereRandomRadius.ToString();
        ShipOnSphereRandomRadius.text =_loaded.ShipOnSphereRandomRadius.ToString();
        DronesInSphereRandomRadius.text = _loaded.DronesInSphereRandomRadius.ToString();
        DronesOnSphereRandomRadius.text =_loaded.DronesOnSphereRandomRadius.ToString();

        _generationNumber = _loaded.GenerationNumber;
        
        MatchConfig.LoadConfig(_loaded.MatchConfig, _hasLoadedExisting);
        MutationConfig.LoadConfig(_loaded.MutationConfig, _hasLoadedExisting);
    }
}
