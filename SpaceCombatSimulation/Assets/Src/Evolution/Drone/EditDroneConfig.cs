using Assets.Src.Database;
using Assets.Src.Evolution;
using UnityEngine.UI;

public class EditDroneConfig : EditBaseConfig
{
    public InputField minDrones;
    public InputField DroneEscalation;
    public InputField MaxDrones;
    public InputField DronesList;

    public InputField ShipInSphereRandomRadius;
    public InputField ShipOnSphereRandomRadius;
    public InputField DronesInSphereRandomRadius;
    public InputField DronesOnSphereRandomRadius;
        
    public override string EvolutionSceneToLoad {
        get
        {
            return "TargetEvolution";
        }
    }
    public override string MainMenuSceneToLoad
    {
        get
        {
            return "MainMenu";
        }
    }

    private EvolutionDroneDatabaseHandler _handler;
    private EvolutionDroneConfig _loaded;

    public override GeneralDatabaseHandler Initialise()
    {
        _handler = new EvolutionDroneDatabaseHandler();
        return _handler;
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

    protected override BaseEvolutionConfig LoadSpecificConfigFromDb()
    {
        _loaded = _hasLoadedExisting ? _handler.ReadConfig(_loadedId) : new EvolutionDroneConfig();
                
        minDrones.text = _loaded.MinDronesToSpawn.ToString();
        DroneEscalation.text = _loaded.ExtraDromnesPerGeneration.ToString();
        MaxDrones.text = _loaded.MaxDronesToSpawn.ToString();
        DronesList.text = _loaded.DronesString.ToString();

        ShipInSphereRandomRadius.text = _loaded.ShipInSphereRandomRadius.ToString();
        ShipOnSphereRandomRadius.text =_loaded.ShipOnSphereRandomRadius.ToString();
        DronesInSphereRandomRadius.text = _loaded.DronesInSphereRandomRadius.ToString();
        DronesOnSphereRandomRadius.text =_loaded.DronesOnSphereRandomRadius.ToString();

        return _loaded;
    }
}
