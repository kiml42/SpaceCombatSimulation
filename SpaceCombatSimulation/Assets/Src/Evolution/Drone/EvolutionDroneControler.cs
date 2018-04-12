using Assets.src.Evolution;
using Assets.Src.Database;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.Menus;
using Assets.Src.ModuleSystem;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;

public class EvolutionDroneControler : BaseEvolutionController
{
    EvolutionDroneConfig _config;
    
    public float CurrentScore = 0;
      
    private GenerationDrone _currentGeneration;
    private int _killsThisMatch = 0;
    private const int SHIP_INDEX = 0;
    private const int DRONES_INDEX = 1;

    private bool _stillAlive;
    private bool _dronesRemain;

    private int _previousDroneCount;
    
    EvolutionDroneDatabaseHandler _dbHandler;

    public RigidbodyList DroneList;

    private bool _hasModules;
    private GenomeWrapper _genomeWrapper;
    
    public override GeneralDatabaseHandler DbHandler
    {
        get
        {
            return _dbHandler;
        }
    }

    protected override BaseEvolutionConfig _baseConfig
    {
        get
        {
            return _config;
        }
    }

    public override IEnumerable<string> Combatants
    {
        get
        {
            return new List<string> { _genomeWrapper.Species };
        }
    }

    // Use this for initialization
    void Start()
    {
        DatabaseId = ArgumentStore.IdToLoad ?? DatabaseId;
        
        _dbHandler = new EvolutionDroneDatabaseHandler();

        _config = _dbHandler.ReadConfig(DatabaseId);
        
        _dbHandler.SetAutoloadId(DatabaseId);

        if (_config == null || _config.DatabaseId != DatabaseId)
        {
            throw new Exception("Did not retrieve expected config from database");
        }
        
        _matchControl = gameObject.AddComponent<EvolutionMatchController>();

        _mutationControl.Config = _config.MutationConfig;
        _matchControl.Config = _config.MatchConfig;
        ShipConfig.Config = _config.MatchConfig;
        
        ReadInGeneration();

        _hasModules = SpawnShips();

        IsMatchOver();
    }

    // Update is called once per frame
    void Update()
    {
        if (Input.GetKeyUp(KeyCode.Escape))
        {
            QuitToMainMenu();
        }
        var matchOver = IsMatchOver();
        if (matchOver || _matchControl.IsOutOfTime())
        {
            var survivalBonus = _matchControl.RemainingTime() * (_stillAlive
                ? _config.CompletionBonus
                : -_config.DeathPenalty);

            Debug.Log("Match over! Score for kills: " + CurrentScore + ", Survival Bonus: " + survivalBonus);
            
            CurrentScore += survivalBonus;

            _currentGeneration.RecordMatch(_genomeWrapper, CurrentScore, _stillAlive, !_dronesRemain, _killsThisMatch);
        
            //save the current generation
            _dbHandler.UpdateGeneration(_currentGeneration, DatabaseId, _config.GenerationNumber);

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
    }

    private bool SpawnShips()
    {
        var genome = _currentGeneration.PickCompetitor();

        for (var j = 0; j < _matchControl.Config.CompetitorsPerTeam; j++)
        {
            _genomeWrapper = ShipConfig.SpawnShip(genome, SHIP_INDEX, 0, _config.ShipInSphereRandomRadius, _config.ShipOnSphereRandomRadius);
        }

        Debug.Log(_genomeWrapper.Name + " enters the arena!");
        Debug.Log("Ship cost = " + _genomeWrapper.Cost);

        SpawnDrones();

        return _genomeWrapper.ModulesAdded > 0;
    }

    private void SpawnDrones()
    {
        var completeKillers = _dbHandler.CountCompleteKillers(_config.DatabaseId, _config.GenerationNumber);
        var DroneCount = _config.MinDronesToSpawn + Math.Floor((double)completeKillers * _config.ExtraDromnesPerGeneration);
        Debug.Log(DroneCount + " drones this match");
        
        var droneTag = ShipConfig.GetTag(DRONES_INDEX);
        var enemyTags = ShipConfig.Tags.Where(t => t != droneTag).ToList();
        
        for (int i = 0; i<DroneCount; i++)
        {
            var dronePrefab = SelectDrone(i);
            //Debug.Log("spawning drone " + genome);
            
            var randomPlacement = _config.MatchConfig.PositionForCompetitor(DRONES_INDEX, 0, _config.DronesInSphereRandomRadius, _config.DronesOnSphereRandomRadius);
            var orientation = _config.MatchConfig.OrientationForStartLocation(randomPlacement);
            var ship = Instantiate(dronePrefab, randomPlacement, orientation);
            ship.tag = droneTag;
            
            ship.velocity = _config.MatchConfig.VelocityForStartLocation(randomPlacement);

            var knower = ship.GetComponent<IKnowsEnemyTags>();
            if(knower != null) knower.KnownEnemyTags = enemyTags;
        }
    }

    private Rigidbody SelectDrone(int index)
    {
        var droneIndex = _config.Drones.Any()
            ? _config.Drones[index % _config.Drones.Count]
            : index % DroneList.Modules.Count;
        var dronePrefab = DroneList.Modules[droneIndex];
        return dronePrefab;
    }
    
    /// <summary>
    /// Updates the score based on the remaining ships.
    /// Returns a true if the match is over because one team is wiped out.
    /// </summary>
    /// <returns>Match is over boolean</returns>
    private bool IsMatchOver()
    {
        //Debug.Log("IsMatchOver");
        if (_matchControl.ShouldPollForWinners())
        {
            var tags = ListShips()
                .Select(s => s.tag);

            var shipCount = tags.Count(t => t == ShipConfig.Tags[SHIP_INDEX]);
            var droneCount = tags.Count(t => t == ShipConfig.Tags[DRONES_INDEX]);
            
            _dronesRemain = droneCount > 0;
            _stillAlive = _hasModules && shipCount > 0; //ships that never had modules are considered dead.
            if (!_hasModules)
            {
                Debug.Log("Ship spawned no modules - it is dead to me.");
            }

            var killedDrones = _previousDroneCount - droneCount;

            //Debug.Log(shipCount + " ship modules, " + droneCount + " drones still alive. (" + _previousDroneCount + " prev) " + _genome);
            if(killedDrones > 0)
            {
                _killsThisMatch += killedDrones;
                var scorePerKill = (_matchControl.RemainingTime() * _config.KillScoreMultiplier) + _config.FlatKillBonus;
                //Debug.Log(killedDrones + " drones killed this interval for " + scorePerKill + " each.");
                CurrentScore += killedDrones * scorePerKill;
            }
            _previousDroneCount = droneCount;
            
            return !_stillAlive || !_dronesRemain;
        }
        return false;
    }
    
    private void ReadInGeneration()
    {
        _currentGeneration = _dbHandler.ReadGeneration(DatabaseId, _config.GenerationNumber);

        if (_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
        {
            //The current generation does not exist - create a new random generation.
            CreateNewGeneration(null);
        } else if(_currentGeneration.MinimumMatchesPlayed >= _config.MinMatchesPerIndividual)
        {
            //the current generation is finished - create a new generation
            var winners = _currentGeneration.PickWinners(_config.WinnersFromEachGeneration);

            _config.GenerationNumber++;

            CreateNewGeneration(winners);
        }
        //Debug.Log("_currentGeneration: " + _currentGeneration);
    }
    
    /// <summary>
    /// Creates and saves a new generation in the database.
    /// If winners are provided, the new generation will be mutatnts of those.
    /// If no winners are provided, the generation number will be reset to 0, and a new default generation will be created.
    /// The current generation is set to the generation that is created.
    /// </summary>
    /// <param name="winners"></param>
    private GenerationDrone CreateNewGeneration(IEnumerable<string> winners)
    {
        if (winners != null && winners.Any())
        {
            _currentGeneration = new GenerationDrone(_mutationControl.CreateGenerationOfMutants(winners.ToList()));
        }
        else
        {
            Debug.Log("Generating generation from default genomes");
            _currentGeneration = new GenerationDrone(_mutationControl.CreateDefaultGeneration());
            _config.GenerationNumber = 0;   //it's always generation 0 for a default genteration.
        }

        _dbHandler.SaveNewGeneration(_currentGeneration, DatabaseId, _config.GenerationNumber);
        _dbHandler.SetCurrentGenerationNumber(DatabaseId, _config.GenerationNumber);

        return _currentGeneration;
    }
}
