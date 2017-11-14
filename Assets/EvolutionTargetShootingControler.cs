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
    #region Ship Config
    [Header("Ship Config")]
    public Rigidbody ShipToEvolve;
    public string Tag1 = "Team1";
    public TestCubeChecker TestCube;
    public Transform StartLocation;
    public float StartLocationRandomisationRadius = 0;
    [Tooltip("Randomise the rotation of all spawned ships")]
    public bool RandomiseRotation = true;
    public float InitialSpeed = 0;
    public float RandomInitialSpeed = 0;
    public string SpaceShipTag = "SpaceShip";
    public int CurrentScore = 0;
    #endregion

    #region "Drones
    [Header("Drones")]
    public int DroneCount = 10;
    public List<string> DroneGenomes = new List<string>();
    public Transform TargetLocation;
    public float TargetLocationRandomisationRadius = 100;
    public string EnemyTag = "Team2";
    #endregion

    #region Files etc.
    [Header("files etc.")]
    public string GeneralFolder = "./tmp/evolvingShipsTargetShooting";
    public string ThisRunFolder = "1";
    private string _currentGenerationFilePath;
    private string _generationFilePathBase;
    #endregion

    #region Generation Setup
    [Header("Generation setup")]
    public int GenerationSize = 20;

    [Tooltip("The generation is over when every individual has had at least this many matches.")]
    public int MinMatchesPerIndividual = 1;

    [Tooltip("The number of individuals to keep for the next generation")]
    public int WinnersFromEachGeneration = 5;

    public int MatchTimeout = 10000;
    public int MatchRunTime = 0;

    public int Mutations = 3;
    public int MaxTurrets = 10;
    public int MaxModules = 15;

    public string AllowedCharacters = " 0123456789  ";
    
    public int MaxMutationLength = 5;

    public int MaxShootAngle = 180;
    public int MaxTorqueMultiplier = 2000;
    public int MaxLocationAimWeighting = 10;
    public int MaxSlowdownWeighting = 60;
    public int MaxLocationTollerance = 1000;
    public int MaxVelociyTollerance = 200;
    public int MaxAngularDragForTorquers = 1;

    public int GenomeLength = 50;
    
    public List<Rigidbody> Modules;
    private StringMutator _mutator;
    public string DefaultGenome = "";

    private int GenerationNumber;
    private GenerationTargetShooting _currentGeneration;
    public int WinnerPollPeriod = 100;
    private int _scoreUpdatePollCountdown = 0;
    #endregion

    private string _genome;

    private bool _stillAlive;
    private bool _dronesRemain;

    private int _previousDroneCount;

    #region score
    [Header("Score")]
    [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
    public int KillScoreMultiplier = 1;

    [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
    public int FlatKillBonus = 100;

    [Tooltip("Bonus Score for killing everything, timesd by remaining frames")]
    public int CompletionBonus = 1;

    [Tooltip("penalty for dieing, multiplied by remining frames")]
    public int DeathPenalty = 1;
    #endregion

    // Use this for initialization
    void Start()
    {
        var basePath = Path.Combine(GeneralFolder, ThisRunFolder);
        _currentGenerationFilePath = Path.Combine(basePath, "CurrentGeneration.txt");
        _generationFilePathBase = Path.Combine(basePath, "Generations/G-");

        _mutator = new StringMutator
        {
            AllowedCharacters = AllowedCharacters,
            GenomeLength = GenomeLength,
            MaxMutationLength = MaxMutationLength,
            Mutations = Mutations
        };
        ReadCurrentGeneration();
        SpawnShips();
        _previousDroneCount = DroneCount;
    }

    // Update is called once per frame
    void Update()
    {
        var matchOver = IsMatchOver();
        if (matchOver || MatchTimeout <= MatchRunTime)
        {
            var survivalBonus =  RemainingFrames() * (_stillAlive
                ? CompletionBonus
                : -DeathPenalty);

            Debug.Log("Match over! Survival Bonus: " + survivalBonus);

            CurrentScore += survivalBonus;

            _currentGeneration.RecordMatch(_genome, CurrentScore, _stillAlive, !_dronesRemain);
        
            SaveGeneration();

            PrepareForNextMatch();

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
        else
        {
            MatchRunTime++;
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
            _currentGeneration = CreateGenerationOfMutants(winners.ToList());
            SaveGeneration();
        }
    }

    private void SaveGeneration()
    {
        string path = PathForThisGeneration();
        Debug.Log("Saving to " + Path.GetFullPath(path));
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
        }
        File.WriteAllText(path, _currentGeneration.ToString());
        File.WriteAllText(_currentGenerationFilePath, GenerationNumber.ToString());
    }

    private string PathForThisGeneration()
    {
        var generationFilePath = _generationFilePathBase + (GenerationNumber.ToString().PadLeft(6, '0'));
        return generationFilePath;
    }
    
    private void SpawnShips()
    {
        _genome = PickContestant();

        Debug.Log(_genome + " enters the arena!");
        

        SpawnShip(_genome, Tag1, EnemyTag, StartLocation, StartLocationRandomisationRadius);

        SpawnDrones();
    }

    private void SpawnDrones()
    {
        for(int i = 0; i<DroneCount; i++)
        {
            var genome = DroneGenomes[i % DroneGenomes.Count];
            SpawnShip(genome, EnemyTag, Tag1, TargetLocation, TargetLocationRandomisationRadius);
        }
    }

    private void SpawnShip(string genome, string ownTag, string enemyTag, Transform location, float locationRandomisationRadius)
    {
        var orientation = RandomiseRotation ? UnityEngine.Random.rotation : location.rotation;
        var randomPlacement = (locationRandomisationRadius * UnityEngine.Random.insideUnitSphere) + location.position;
        var ship = Instantiate(ShipToEvolve, randomPlacement, orientation);
        ship.tag = ownTag;
        var enemyTags = new List<string> { enemyTag };

        var velocity = location.forward * InitialSpeed + UnityEngine.Random.insideUnitSphere * RandomInitialSpeed;
        
        new ShipBuilder(genome, ship.transform, Modules, TestCube)
        {
            MaxShootAngle = MaxShootAngle,
            MaxTorqueMultiplier = MaxTorqueMultiplier,
            MaxLocationAimWeighting = MaxLocationAimWeighting,
            MaxSlowdownWeighting = MaxSlowdownWeighting,
            MaxLocationTollerance = MaxLocationTollerance,
            MaxVelociyTollerance = MaxVelociyTollerance,
            MaxAngularDragForTorquers = MaxAngularDragForTorquers,
            EnemyTags = enemyTags,
            MaxTurrets = MaxTurrets,
            MaxModules = MaxModules,
            InitialVelocity = velocity
        }.BuildShip();
        ship.velocity = velocity;

        ship.SendMessage("SetEnemyTags", enemyTags);
    }
    
    /// <summary>
    /// Updates the score based on the remaining ships.
    /// Returns a true if the match is over because one team is wiped out.
    /// </summary>
    /// <returns>Match is over boolean</returns>
    private bool IsMatchOver()
    {
        if(_scoreUpdatePollCountdown-- <= 0)
        {
            _scoreUpdatePollCountdown = WinnerPollPeriod;
            var tags = ListShips()
                .Select(s => s.tag);

            var shipCount = tags.Count(t => t == Tag1);
            var droneCount = tags.Count(t => t == EnemyTag);


            _dronesRemain = droneCount > 0;
            _stillAlive = shipCount > 0;

            var killedDrones = _previousDroneCount - droneCount;

            if(killedDrones > 0)
            {
                Debug.Log(killedDrones + " drones killed this interval");
                Debug.Log(shipCount + " ship modules, " + droneCount + " drones still alive.");
                CurrentScore += killedDrones * ((RemainingFrames() * KillScoreMultiplier) + FlatKillBonus);
            }

            _previousDroneCount = droneCount;

            //return true if one team is wipred out.
            return !_stillAlive || !_dronesRemain;
        }
        return false;
    }

    private int RemainingFrames()
    {
        return MatchTimeout - MatchRunTime;
    }

    private IEnumerable<Transform> ListShips()
    {
        return GameObject.FindGameObjectsWithTag(SpaceShipTag)
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
        if (File.Exists(_currentGenerationFilePath))
        {
            var GenerationNumberText = File.ReadAllText(_currentGenerationFilePath);
            if(!int.TryParse(GenerationNumberText, out GenerationNumber))
            {
                GenerationNumber = 0;
            }
            string path = PathForThisGeneration();

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
            _currentGeneration = CreateGenerationOfMutants(new List<string> { DefaultGenome });
        }
        //Debug.Log("_currentGeneration: " + _currentGeneration);
    }

    private GenerationTargetShooting CreateGenerationOfMutants(List<string> baseGenomes)
    {
        //Debug.Log("Generating generation from [" + string.Join(",", baseGenomes.ToArray()) + "]");
        var genration = new GenerationTargetShooting();
        int i = 0;
        //Debug.Log("IndinvidualsCount = " + genration.CountIndividuals());
        while (genration.CountIndividuals() < GenerationSize)
        {

            var baseGenome = baseGenomes[i];
            var mutant = _mutator.Mutate(baseGenome);
            if (IsValidGenome(mutant))
            {
                Debug.Log(mutant + " spawn of " + baseGenome + " is born");
                genration.AddGenome(mutant);
                //Debug.Log("IndinvidualsCount = " + genration.CountIndividuals());
            } else
            {
                Debug.Log(mutant + " spawn of " + baseGenome + " is too rubbish to be born");
            }
            i++;
            i = i % baseGenomes.Count;
        }
        //Debug.Log("mutant Generation: " + genration);
        return genration;
    }
    
    private bool IsValidGenome(string baseGenome)
    {
        var start = baseGenome.Substring(0, 6).Trim();
        //Debug.Log("'" + start + "'");
        var valid = !string.IsNullOrEmpty(start);
        //Debug.Log("'" + baseGenome + "' valid? " + valid);
        return valid;
    }
}
