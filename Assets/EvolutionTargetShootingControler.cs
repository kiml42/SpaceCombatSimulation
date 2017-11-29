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

public class EvolutionTargetShootingControler : MonoBehaviour
{
    public EvolutionShipConfig ShipConfig;
    public EvolutionFileManager FileManager;
    public EvolutionMutationController MutationControl;
    public EvolutionMatchController MatchControl;
    public float CurrentScore = 0;

    #region "Drones
    [Header("Drones")]
    public List<Rigidbody> Drones = new List<Rigidbody>();

    [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration/ExtraDroneEveryXGenerations")]
    public int MinDronesToSpawn = 3;
    [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration/ExtraDroneEveryXGenerations")]
    public int ExtraDroneEveryXGenerations = 5;
    public int MaxDronesToSpawn = 100;
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
    public int KillScoreMultiplier = 300;

    [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
    public int FlatKillBonus = 100;

    [Tooltip("Bonus Score for killing everything, timesd by remaining frames")]
    public int CompletionBonus = 100;

    [Tooltip("penalty for dieing, multiplied by remining frames")]
    public int DeathPenalty = 70;
    #endregion

    private int GenerationNumber;
    private GenerationTargetShooting _currentGeneration;
    private int _killsThisMatch = 0;
    private const int SHIP_INDEX = 0;
    private const int DRONES_INDEX = 1;

    private string _genome;

    private bool _stillAlive;
    private bool _dronesRemain;

    private int _previousDroneCount;
    
    #region config inicies
    //Generations
    private const int CURRENT_GEN_INDEX = 0;
    private const int MIN_MATCHES_INDEX = 1;
    private const int WINNERS_COUNT_INDEX = 2;

    //Drones
    private const int DRONES_LIST_INDEX = 3;
    private const int MIN_DRONES_INDEX = 4;
    private const int DRONE_ESCALATION_INDEX = 5;
    private const int MAX_DRONES_INDEX = 6;

    //Mutations
    private const int MUTATIONS_COUNT_INDEX = 7;
    private const int ALLOWED_CHARS_INDEX = 8;
    private const int MAX_MUTATION_LENGTH_INDEX = 9;
    private const int GENOME_LENGTH_INDEX = 10;
    private const int GENERATION_SIZE_INDEX = 11;
    private const int RANDOM_DEFAULT_INDEX = 12;
    private const int DEFAULT_GENOME_INDEX = 13;

    //Match
    private const int MATCH_TIMEOUT_INDEX = 14;
    private const int WINNER_POLL_PERIOD_INDEX = 15;

    //score
    private const int KILL_MULTIPLIER_INDEX = 16;
    private const int KILL_SCORE_INDEX = 17;
    private const int COMPLETION_BONUS_INDEX = 18;
    private const int DEATH_PENALTY_INDEX = 19;
    #endregion

    // Use this for initialization
    void Start()
    {
        ReadConfigAndCurrentGeneration();
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
        
            SaveGeneration();

            PrepareForNextMatch();

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
    }

    private void SaveGeneration()
    {
        //Debug.Log("Saving Generation");
        string[] configText = new string[20];

        configText[CURRENT_GEN_INDEX] = GenerationNumber.ToString();
        configText[MIN_MATCHES_INDEX] = MinMatchesPerIndividual.ToString();
        configText[WINNERS_COUNT_INDEX] = WinnersFromEachGeneration.ToString();

        var dronesString = string.Join(";", Drones.Select(d => AssetDatabase.GetAssetPath(d)).ToArray());
        //Debug.Log("dronesString: '" + dronesString  + "'.");
        configText[DRONES_LIST_INDEX] = dronesString;
        configText[MIN_DRONES_INDEX] = MinDronesToSpawn.ToString();
        configText[DRONE_ESCALATION_INDEX] = ExtraDroneEveryXGenerations.ToString();
        configText[MAX_DRONES_INDEX] = MaxDronesToSpawn.ToString();

        configText[MUTATIONS_COUNT_INDEX] = MutationControl.Mutations.ToString();
        configText[ALLOWED_CHARS_INDEX] = MutationControl.AllowedCharacters;
        configText[MAX_MUTATION_LENGTH_INDEX] = MutationControl.MaxMutationLength.ToString();
        configText[GENOME_LENGTH_INDEX] = MutationControl.GenomeLength.ToString();
        configText[GENERATION_SIZE_INDEX] = MutationControl.GenerationSize.ToString();
        configText[RANDOM_DEFAULT_INDEX] = MutationControl.UseCompletelyRandomDefaultGenome.ToString();
        configText[DEFAULT_GENOME_INDEX] = MutationControl.DefaultGenome;

        configText[MATCH_TIMEOUT_INDEX] = MatchControl.MatchTimeout.ToString();
        configText[WINNER_POLL_PERIOD_INDEX] = MatchControl.WinnerPollPeriod.ToString();

        configText[KILL_MULTIPLIER_INDEX] = KillScoreMultiplier.ToString();
        configText[KILL_SCORE_INDEX] = FlatKillBonus.ToString();
        configText[COMPLETION_BONUS_INDEX] = CompletionBonus.ToString();
        configText[DEATH_PENALTY_INDEX] = DeathPenalty.ToString();

        FileManager.SaveGeneration(_currentGeneration, GenerationNumber, configText);
    }

    private void PrepareForNextMatch()
    {
        if(_currentGeneration.MinimumMatchesPlayed() >= MinMatchesPerIndividual)
        {
            //should move to next generation
            var winners = _currentGeneration.PickWinners(WinnersFromEachGeneration);
            GenerationNumber++;
            _currentGeneration = new GenerationTargetShooting(MutationControl.CreateGenerationOfMutants(winners.ToList()));
            SaveGeneration();
        }
    }
    
    private void SpawnShips()
    {
        _genome = PickContestant();

        Debug.Log(_genome + " enters the arena!");

        ShipConfig.SpawnShip(_genome, SHIP_INDEX);

        SpawnDrones();
    }

    private void SpawnDrones()
    {
        var DroneCount = MinDronesToSpawn + Math.Floor((double) GenerationNumber / ExtraDroneEveryXGenerations);
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
        
    private string PickContestant()
    {
        var g1 = _currentGeneration.PickCompetitor();
        return g1;
    }

    private void ReadConfigAndCurrentGeneration()
    {
        var configText = FileManager.ReadConfigFile();
        if(configText != null && configText.Any())
        {
            //Debug.Log("ParsingConfigFile");
            GenerationNumber = int.Parse(configText[CURRENT_GEN_INDEX]);
            if(configText.Length >= 19)
            {
                MinMatchesPerIndividual =  int.Parse(configText[MIN_MATCHES_INDEX]);
                WinnersFromEachGeneration = int.Parse(configText[WINNERS_COUNT_INDEX]);

                var dronesString = configText[DRONES_LIST_INDEX];
                //Debug.Log("Reading: dronesString: '" + dronesString + "'.");
                var splitDronesString = dronesString.Split(';');
                Drones = splitDronesString.Select(d => AssetDatabase.LoadAssetAtPath<Rigidbody>(d)).ToList();
                MinDronesToSpawn = int.Parse(configText[MIN_DRONES_INDEX] );
                ExtraDroneEveryXGenerations = int.Parse(configText[DRONE_ESCALATION_INDEX] );
                MaxDronesToSpawn = int.Parse(configText[MAX_DRONES_INDEX] );

                MutationControl.Mutations = int.Parse(configText[MUTATIONS_COUNT_INDEX]);
                MutationControl.AllowedCharacters = configText[ALLOWED_CHARS_INDEX] ;
                MutationControl.MaxMutationLength = int.Parse(configText[MAX_MUTATION_LENGTH_INDEX] );
                MutationControl.GenomeLength = int.Parse(configText[GENOME_LENGTH_INDEX] );
                MutationControl.GenerationSize = int.Parse(configText[GENERATION_SIZE_INDEX] );
                MutationControl.UseCompletelyRandomDefaultGenome = bool.Parse(configText[RANDOM_DEFAULT_INDEX] );
                MutationControl.DefaultGenome = configText[DEFAULT_GENOME_INDEX];

                MatchControl.MatchTimeout = float.Parse(configText[MATCH_TIMEOUT_INDEX]);
                MatchControl.WinnerPollPeriod = float.Parse(configText[WINNER_POLL_PERIOD_INDEX]);

                KillScoreMultiplier = int.Parse(configText[KILL_MULTIPLIER_INDEX] );
                FlatKillBonus = int.Parse(configText[KILL_SCORE_INDEX] );
                CompletionBonus = int.Parse(configText[COMPLETION_BONUS_INDEX] );
                DeathPenalty = int.Parse(configText[DEATH_PENALTY_INDEX] );
            }
            else
            {
                Debug.LogWarning(FileManager.ConfigFilePath + " is an old style generation file. Some config may be incorrectly defaulted.");
            }
        }
            
        string path = FileManager.PathForThisGeneration(GenerationNumber);

        //Debug.Log("looking for genreation at " + path);
        if (File.Exists(path))
        {
            var lines = File.ReadAllLines(path);
            _currentGeneration = new GenerationTargetShooting(lines);
        }
        else
        {
            Debug.LogWarning("Unable to find generation file: " + path);
        }
        
        if(_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
        {
            Debug.Log("Generating generation from default genomes");
            _currentGeneration = new GenerationTargetShooting(MutationControl.CreateDefaultGeneration());
        }
        //Debug.Log("_currentGeneration: " + _currentGeneration);
    }
}
