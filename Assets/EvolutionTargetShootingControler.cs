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
    public Rigidbody ShipToEvolve;
    public TestCubeChecker TestCube;
    public Transform StartLocation;
    public Transform TargetLocation;
    public bool RandomiseRotation = true;
    public float StartLocationRandomisationRadius = 0;
    public float TargetLocationRandomisationRadius = 0;
    public string Tag1 = "Team1";
    public string EnemyTag = "Team2";
    public string GeneralFolder = "./tmp/evolvingShipsTargetShooting";
    public string ThisRunFolder = "1";
    private string _currentGenerationFilePath;
    private string _generationFilePathBase;
    public float InitialSpeed = 0;
    public float RandomInitialSpeed = 0;

    public string SpaceShipTag = "SpaceShip";
    private Dictionary<string, string> _currentGenomes;

    public int GenerationSize = 20;

    /// <summary>
    /// The generation is over when every individual has had at least this many matches.
    /// </summary>
    public int MinMatchesPerIndividual = 1;

    /// <summary>
    /// The number of individuals to keep for the next generation
    /// </summary>
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
    private int _winnerPollCountdown = 0;

    public float currentScore = 0;

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
    }

    // Update is called once per frame
    void Update()
    {
        var winningGenome = AddToScore();
        if (MatchTimeout > MatchRunTime)
        {
            MatchRunTime++;
            return;
        }
        else
        {
            Debug.Log("Match over!");
        }

        if (winningGenome != null)
        {
            Debug.Log("\"" + winningGenome + "\" Wins!");
            var a = _currentGenomes.Values.First();
            var b = _currentGenomes.Values.Skip(1).First();
            
            _currentGeneration.RecordMatch(a, b, winningGenome, winScore, losScore, drawScore);
        
            SaveGeneration();

            PrepareForNextMatch();

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
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
        var genome = PickContestant();

        Debug.Log(genome + " enters the arena!");
        

        SpawnShip(genome, Tag1, EnemyTag, StartLocation, StartLocationRandomisationRadius);

        SpawnDrones();
    }

    private void SpawnDrones()
    {
        throw new NotImplementedException();
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

    public string _previousWinner;

    /// <summary>
    /// Returns the genome of the victor.
    /// Or null if there's no victor yet.
    /// Or empty string if everyone's dead.
    /// </summary>
    /// <returns></returns>
    private string AddToScore()
    {
        if(_winnerPollCountdown-- <= 0)
        {
            string currentWinner = null;
            _winnerPollCountdown = WinnerPollPeriod;
            var tags = ListShips()
                .Select(s => s.tag)
                .Distinct();
            //Debug.Log(ships.Count() + " ships exist");

            if (tags.Count() == 1)
            {
                var winningTag = tags.First();

                //Debug.Log(StringifyGenomes() + " winning tag: " + winningTag);
                currentWinner = _currentGenomes[winningTag];
            }
            if (tags.Count() == 0)
            {
                Debug.Log("Everyone's dead!");
                currentWinner = string.Empty;
            }

            var actualWinner = currentWinner == _previousWinner ? currentWinner : null;
            _previousWinner = currentWinner;
            //if there's ben the same winner for two consectutive periods return that, otherise null.
            return actualWinner;
        }
        return null;
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
