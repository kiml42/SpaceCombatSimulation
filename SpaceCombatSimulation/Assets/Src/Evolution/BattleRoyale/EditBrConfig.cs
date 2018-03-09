using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;
using Assets.Src.Database;
using System;
using UnityEngine.SceneManagement;
using Assets.Src.Menus;

public class EditBrConfig : EditBaseConfig
{
    public InputField NumberOfTeams;
    public InputField InSphereRandomisationRadius;
    public InputField OnSphereRandomisationRadius;
        
    public override string EvolutionSceneToLoad { get { return "1v1Evolution"; } }
    public override string MainMenuSceneToLoad
    {
        get
        {
            return "MainMenu";
        }
    }

    private EvolutionBrDatabaseHandler _handler;
    private EvolutionBrConfig _loaded;


    public override void Initialise()
    {
        _handler = new EvolutionBrDatabaseHandler();
    }

    protected override int SaveConfig()
    {
        var config = ReadControlls();

        if (_hasLoadedExisting)
        {
            return _handler.UpdateExistingConfig(config);
        }
        else
        {
            return _handler.SaveNewConfig(config);
        }
    }

    protected override int SaveNewConfig()
    {
        var config = ReadControlls();

        config.GenerationNumber = 0;

        return _handler.SaveNewConfig(config);
    }

    private EvolutionBrConfig ReadControlls()
    {
        _loaded.MatchConfig = MatchConfig.ReadFromControls();
        _loaded.MutationConfig = MutationConfig.ReadFromControls();

        _loaded.RunName = RunName.text;
        _loaded.MinMatchesPerIndividual = int.Parse(MinMatchesPerIndividual.text);
        _loaded.WinnersFromEachGeneration = int.Parse(WinnersFromEachGeneration.text);
        _loaded.GenerationNumber = _generationNumber;
        _loaded.NumberOfCombatants = int.Parse(NumberOfTeams.text);
        _loaded.InSphereRandomisationRadius = float.Parse(InSphereRandomisationRadius.text);
        _loaded.OnSphereRandomisationRadius = float.Parse(OnSphereRandomisationRadius.text);

        return _loaded;
    }
    
    protected override BaseEvolutionConfig LoadSpecificConfigFromDb()
    {
        _loaded = _hasLoadedExisting ? _handler.ReadConfig(_loadedId) : new EvolutionBrConfig();
        
        NumberOfTeams.text = _loaded.NumberOfCombatants.ToString();

        InSphereRandomisationRadius.text = _loaded.InSphereRandomisationRadius.ToString();
        OnSphereRandomisationRadius.text = _loaded.OnSphereRandomisationRadius.ToString();

        return _loaded;
    }
}
