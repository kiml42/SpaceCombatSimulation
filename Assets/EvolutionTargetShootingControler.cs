using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;
using System.IO;
using Assets.Src.ObjectManagement;
using UnityEditor;
using Assets.Src.Database;

public class EvolutionTargetShootingControler : MonoBehaviour
{
    public int DatabaseId;

    public string RunName;

    public EvolutionShipConfig ShipConfig;
    public EvolutionMutationController MutationControl;
    public EvolutionMatchController MatchControl;
    public float CurrentScore = 0;

    #region "Drones
    [Header("Drones")]
    public List<Rigidbody> Drones = new List<Rigidbody>();

    [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration * ExtraDromnesPerGeneration")]
    public int MinDronesToSpawn = 3;

    [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration * ExtraDromnesPerGeneration")]
    public float ExtraDromnesPerGeneration = 5;
    public int MaxDronesToSpawn = 100;
    
    public string DronesString
    {
        get
        {
            return string.Join(";", Drones.Select(d => AssetDatabase.GetAssetPath(d)).ToArray());
        }
        set
        {
            var splitDronesString = value.Split(';');
            Drones = splitDronesString.Select(d => AssetDatabase.LoadAssetAtPath<Rigidbody>(d)).ToList();
        }
    }
    #endregion

    #region Generation Setup
    [Header("Generation setup")]
    [Tooltip("The generation is over when every individual has had at least this many matches.")]
    public int MinMatchesPerIndividual = 1;

    [Tooltip("The number of individuals to keep for the next generation")]
    public int WinnersFromEachGeneration = 5;
    #endregion
    
    #region score
    [Header("Score")]
    [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
    public float KillScoreMultiplier = 300;

    [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
    public float FlatKillBonus = 100;

    [Tooltip("Bonus Score for killing everything, timesd by remaining frames")]
    public float CompletionBonus = 100;

    [Tooltip("penalty for dieing, multiplied by remining frames")]
    public float DeathPenalty = 70;
    #endregion

    public int GenerationNumber;
    private GenerationTargetShooting _currentGeneration;
    private int _killsThisMatch = 0;
    private const int SHIP_INDEX = 0;
    private const int DRONES_INDEX = 1;

    private string _genome;

    private bool _stillAlive;
    private bool _dronesRemain;

    private int _previousDroneCount;
    
    EvolutionTargetShootingDatabaseHandler _dbHandler;

    // Use this for initialization
    void Start()
    {
        //Debug.Log("EvolutionTargetShootingControler starting");
        _dbHandler = new EvolutionTargetShootingDatabaseHandler(this);

        _dbHandler.ReadConfig(DatabaseId);

        ReadInGeneration();

        SpawnShips();

        IsMatchOver();
    }

    // Update is called once per frame
    void Update()
    {
        var matchOver = IsMatchOver();
        if (matchOver || MatchControl.IsOutOfTime())
        {
            var survivalBonus = MatchControl.RemainingTime() * (_stillAlive
                ? CompletionBonus
                : -DeathPenalty);

            Debug.Log("Match over! Score for kills: " + CurrentScore + ", Survival Bonus: " + survivalBonus);

            CurrentScore += survivalBonus;

            _currentGeneration.RecordMatch(_genome, CurrentScore, _stillAlive, !_dronesRemain, _killsThisMatch);
        
            //save the current generation
            SaveGeneration();

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
    }

    private void SpawnShips()
    {
        _genome = _currentGeneration.PickCompetitor();

        Debug.Log(_genome + " enters the arena!");

        ShipConfig.SpawnShip(_genome, SHIP_INDEX);

        SpawnDrones();
    }

    private void SpawnDrones()
    {
        var DroneCount = MinDronesToSpawn + Math.Floor((double) GenerationNumber * ExtraDromnesPerGeneration);
        Debug.Log(DroneCount + " drones this match");

        var locationTransform = ShipConfig.GetLocation(DRONES_INDEX);
        var randRadius = ShipConfig.GetLocationRandomisationRadius(DRONES_INDEX);
        var droneTag = ShipConfig.GetTag(DRONES_INDEX);
        var enemyTags = ShipConfig.Tags.Where(t => t != droneTag).ToList();

        for (int i = 0; i<DroneCount; i++)
        {
            var dronePrefab = Drones[i % Drones.Count];
            //Debug.Log("spawning drone " + genome);
            
            var orientation = ShipConfig.RandomiseRotation ? UnityEngine.Random.rotation : locationTransform.rotation;
            var randomPlacement = (randRadius * UnityEngine.Random.insideUnitSphere) + locationTransform.position;
            var ship = Instantiate(dronePrefab, randomPlacement, orientation);
            ship.tag = droneTag;
            
            ship.velocity = locationTransform.forward * ShipConfig.InitialSpeed + UnityEngine.Random.insideUnitSphere * ShipConfig.RandomInitialSpeed;

            ship.SendMessage("SetEnemyTags", enemyTags, SendMessageOptions.DontRequireReceiver);
        }
    }
    
    /// <summary>
    /// Updates the score based on the remaining ships.
    /// Returns a true if the match is over because one team is wiped out.
    /// </summary>
    /// <returns>Match is over boolean</returns>
    private bool IsMatchOver()
    {
        //Debug.Log("IsMatchOver");
        if (MatchControl.ShouldPollForWinners())
        {
            var tags = ListShips()
                .Select(s => s.tag);

            var shipCount = tags.Count(t => t == ShipConfig.Tags[SHIP_INDEX]);
            var droneCount = tags.Count(t => t == ShipConfig.Tags[DRONES_INDEX]);
            
            _dronesRemain = droneCount > 0;
            _stillAlive = shipCount > 0;

            var killedDrones = _previousDroneCount - droneCount;

            //Debug.Log(shipCount + " ship modules, " + droneCount + " drones still alive. (" + _previousDroneCount + " prev) " + _genome);
            if(killedDrones > 0)
            {
                _killsThisMatch += killedDrones;
                var scorePerKill = (MatchControl.RemainingTime() * KillScoreMultiplier) + FlatKillBonus;
                Debug.Log(killedDrones + " drones killed this interval for " + scorePerKill + " each.");
                CurrentScore += killedDrones * scorePerKill;
            }
            _previousDroneCount = droneCount;
            
            //return true if one team is wipred out.
            return !_stillAlive || !_dronesRemain;
        }
        return false;
    }

    private IEnumerable<Transform> ListShips()
    {
        return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                .Where(s =>
                    s.transform.parent != null &&
                    s.transform.parent.GetComponent("Rigidbody") != null
                ).Select(s => s.transform.parent);
    }
    
    private void ReadInGeneration()
    {
        _currentGeneration = _dbHandler.ReadCurrentGeneration();

        if (_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
        {
            //The current generation does not exist - create a new random generation.
            CreateNewGeneration(null);
        } else if(_currentGeneration.MinimumMatchesPlayed >= MinMatchesPerIndividual)
        {
            //the current generation is finished - create a new generation
            var winners = _currentGeneration.PickWinners(WinnersFromEachGeneration);

            GenerationNumber++;

            CreateNewGeneration(winners);
        }
        //Debug.Log("_currentGeneration: " + _currentGeneration);
    }
    
    /// <summary>
    /// Creates and saves a new generation in the daabese.
    /// If winners are provided, the new generation will be mutatnts of those.
    /// If no winners are provided, the generation number will be reset to 0, and a new default generation will be created.
    /// The current generation is set to the generation that is created.
    /// </summary>
    /// <param name="winners"></param>
    private GenerationTargetShooting CreateNewGeneration(IEnumerable<string> winners)
    {
        if (winners != null && winners.Any())
        {
            _currentGeneration = new GenerationTargetShooting(MutationControl.CreateGenerationOfMutants(winners.ToList()));
        }
        else
        {
            Debug.Log("Generating generation from default genomes");
            _currentGeneration = new GenerationTargetShooting(MutationControl.CreateDefaultGeneration());
            GenerationNumber = 0;   //it's always generation 0 for a default genteration.
        }

        _dbHandler.SaveNewGeneration(_currentGeneration, DatabaseId, GenerationNumber);
        _dbHandler.SetCurrentGeneration(GenerationNumber);

        return _currentGeneration;
    }

    private void SaveGeneration()
    {
        //Debug.Log("Updating Generation In DB");
        _dbHandler.UpdateGeneration(_currentGeneration, DatabaseId, GenerationNumber);
    }
}
