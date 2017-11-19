using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;
using System.IO;
using Assets.Src.ObjectManagement;

public class EvolutionTargetShootingControler : MonoBehaviour
{
    public EvolutionShipConfig ShipConfig;
    public EvolutionFileManager FileManager;
    public EvolutionMutationController MutationControl;
    public float CurrentScore = 0;

    #region "Drones
    [Header("Drones")]
    public List<string> DroneGenomes = new List<string>();

    [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration/ExtraDroneEveryXGenerations")]
    public int MinDronesToSpawn = 3;
    [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration/ExtraDroneEveryXGenerations")]
    public int ExtraDroneEveryXGenerations = 5;
    #endregion

    #region Generation Setup
    [Header("Generation setup")]
    [Tooltip("The generation is over when every individual has had at least this many matches.")]
    public int MinMatchesPerIndividual = 1;

    [Tooltip("The number of individuals to keep for the next generation")]
    public int WinnersFromEachGeneration = 5;
    #endregion

    #region Match Setup
    [Header("Match setup")]
    public float MatchTimeout = 10000;
    public float MatchRunTime = 0;
    
    private int GenerationNumber;
    private GenerationTargetShooting _currentGeneration;
    public float WinnerPollPeriod = 1;
    private float _scoreUpdatePollCountdown = 0;
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

    private int _killsThisMatch = 0;
    private const int SHIP_INDEX = 0;
    private const int DRONES_INDEX = 1;
    #endregion

    private string _genome;

    private bool _stillAlive;
    private bool _dronesRemain;

    private int _previousDroneCount;

    // Use this for initialization
    void Start()
    {
        ReadCurrentGeneration();
        SpawnShips();
        IsMatchOver();
    }

    // Update is called once per frame
    void Update()
    {
        var matchOver = IsMatchOver();
        if (matchOver || MatchTimeout <= MatchRunTime)
        {
            var survivalBonus =  RemainingTime() * (_stillAlive
                ? CompletionBonus
                : -DeathPenalty);

            Debug.Log("Match over! Score for kills: " + CurrentScore + ", Survival Bonus: " + survivalBonus);

            CurrentScore += survivalBonus;

            _currentGeneration.RecordMatch(_genome, CurrentScore, _stillAlive, !_dronesRemain, _killsThisMatch);
        
            FileManager.SaveGeneration(_currentGeneration, GenerationNumber);

            PrepareForNextMatch();

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
        else
        {
            MatchRunTime+=Time.deltaTime;
            return;
        }
    }

    private void PrepareForNextMatch()
    {
        if(_currentGeneration.MinimumMatchesPlayed() >= MinMatchesPerIndividual)
        {
            //should move to next generation
            var winners = _currentGeneration.PickWinners(WinnersFromEachGeneration);
            GenerationNumber = GenerationNumber+1;
            _currentGeneration = new GenerationTargetShooting(MutationControl.CreateGenerationOfMutants(winners.ToList()));
            FileManager.SaveGeneration(_currentGeneration, GenerationNumber);
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
        for (int i = 0; i<DroneCount; i++)
        {
            var genome = DroneGenomes[i % DroneGenomes.Count];
            //Debug.Log("spawning drone " + genome);

            ShipConfig.SpawnShip(genome, DRONES_INDEX);
        }
    }

    
    /// <summary>
    /// Updates the score based on the remaining ships.
    /// Returns a true if the match is over because one team is wiped out.
    /// </summary>
    /// <returns>Match is over boolean</returns>
    private bool IsMatchOver()
    {
        _scoreUpdatePollCountdown -= Time.deltaTime;
        if (_scoreUpdatePollCountdown <= 0)
        {

            _scoreUpdatePollCountdown = WinnerPollPeriod;
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
                var scorePerKill = (RemainingTime() * KillScoreMultiplier) + FlatKillBonus;
                Debug.Log(killedDrones + " drones killed this interval for " + scorePerKill + " each.");
                CurrentScore += killedDrones * scorePerKill;
            }
            _previousDroneCount = droneCount;


            //return true if one team is wipred out.
            return !_stillAlive || !_dronesRemain;
        }
        return false;
    }

    private float RemainingTime()
    {
        return Math.Max(MatchTimeout - MatchRunTime, 0);
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

    private void ReadCurrentGeneration()
    {
        if (File.Exists(FileManager.CurrentGenerationFilePath))
        {
            var GenerationNumberText = File.ReadAllText(FileManager.CurrentGenerationFilePath);
            if(!int.TryParse(GenerationNumberText, out GenerationNumber))
            {
                GenerationNumber = 0;
            }
            string path = FileManager.PathForThisGeneration(GenerationNumber);

            //Debug.Log("looking for genreation at " + path);

            var lines = File.ReadAllLines(path);
            _currentGeneration = new GenerationTargetShooting(lines);
        } else
        {
            Debug.Log("Current generation File not found mutating default for new generation");
        }
        if(_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
        {
            //Debug.Log("Generating generation from default genomes");
            _currentGeneration = new GenerationTargetShooting(MutationControl.CreateDefaultGeneration());
        }
        //Debug.Log("_currentGeneration: " + _currentGeneration);
    }
}
