using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;
using System.IO;
using Assets.Src.ObjectManagement;

public class EvolutionControler : MonoBehaviour
{
    public EvolutionShipConfig ShipConfig;
    public EvolutionFileManager FileManager;
    public EvolutionMutationController MutationControl;
    public EvolutionMatchController MatchControl;
    
    private Dictionary<string, string> _currentGenomes;

    /// <summary>
    /// The generation is over when every individual has had at least this many matches.
    /// </summary>
    public int MinMatchesPerIndividual = 3;

    /// <summary>
    /// The number of individuals to keep for the next generation
    /// </summary>
    public int WinnersFromEachGeneration = 3;
    
    public int MaxShootAngle = 180;
    public int MaxTorqueMultiplier = 2000;
    public int MaxLocationAimWeighting = 10;
    public int MaxSlowdownWeighting = 60;
    public int MaxLocationTollerance = 1000;
    public int MaxVelociyTollerance = 200;
    public int MaxAngularDragForTorquers = 1;

    private int GenerationNumber;
    private Generation1V1 _currentGeneration;

    public float SuddenDeathDamage = 10;
    /// <summary>
    /// Time for repeating the sudden death damage.
    /// Also used as the minimum score for winning a match.
    /// </summary>
    public float SuddenDeathReloadTime = 200;

    // Use this for initialization
    void Start()
    {
        ReadCurrentGeneration();
        SpawnShips();
    }

    // Update is called once per frame
    void Update()
    {
        var winningGenome = DetectVictorsGenome();
        if (winningGenome == null && !MatchControl.IsOutOfTime())
        {
            return;
        }
        else if (MatchControl.IsOutOfTime()/* && _previousWinner == null*/)
        {
            //Debug.Log("Match Timeout!");
            ActivateSuddenDeath();
        }

        if (winningGenome != null)
        {
            Debug.Log("\"" + winningGenome + "\" Wins!");
            var a = _currentGenomes.Values.First();
            var b = _currentGenomes.Values.Skip(1).First();

            var winScore = Math.Max(MatchControl.RemainingTime(), SuddenDeathReloadTime);

            var losScore = -SuddenDeathReloadTime;
            var drawScore = -SuddenDeathReloadTime/2;

            _currentGeneration.RecordMatch(a, b, winningGenome, winScore, losScore, drawScore);
        
            FileManager.SaveGeneration(_currentGeneration, GenerationNumber);

            PrepareForNextMatch();

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
    }

    private void ActivateSuddenDeath()
    {
        //Debug.Log("Sudden Death!");
        var ships = ListShips();
        foreach (var ship in ships)
        {
            ship.transform.SendMessage("ApplyDamage", SuddenDeathDamage, SendMessageOptions.DontRequireReceiver);
        }
        MatchControl.MatchTimeout = SuddenDeathReloadTime;
        MatchControl.MatchRunTime = 0;
    }

    private void PrepareForNextMatch()
    {
        if(_currentGeneration.MinimumMatchesPlayed() >= MinMatchesPerIndividual)
        {
            //should move to next generation
            var winners = _currentGeneration.PickWinners(WinnersFromEachGeneration);
            GenerationNumber = GenerationNumber+1;
            _currentGeneration = new Generation1V1(MutationControl.CreateGenerationOfMutants(winners.ToList()));
            FileManager.SaveGeneration(_currentGeneration, GenerationNumber);
        }
    }

    private void SpawnShips()
    {
        var genomes = PickTwoGenomesFromHistory();

        Debug.Log("\"" + string.Join("\" vs \"", genomes.ToArray()) + "\"");

        _currentGenomes = new Dictionary<string, string>();
        var i = 0;
        foreach (var g in genomes)
        {
            ShipConfig.SpawnShip(g, i);
            _currentGenomes[ShipConfig.GetTag(i)] = g;

            i++;
        }
    }
    
    public string _previousWinner;

    /// <summary>
    /// Returns the genome of the victor.
    /// Or null if there's no victor yet.
    /// Or empty string if everyone's dead.
    /// </summary>
    /// <returns></returns>
    private string DetectVictorsGenome()
    {
        if (MatchControl.ShouldPollForWinners())
        {
            string currentWinner = null;

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
            //if there's been the same winner for two consectutive periods return that, otherise null.
            return actualWinner;
        }
        return null;
    }

    private IEnumerable<Transform> ListShips()
    {
        return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                .Where(s =>
                    s.transform.parent != null &&
                    s.transform.parent.GetComponent("Rigidbody") != null
                ).Select(s => s.transform.parent);
    }
        
    private string[] PickTwoGenomesFromHistory()
    {
        var g1 = _currentGeneration.PickCompetitor();
        var g2 = _currentGeneration.PickCompetitor(g1);
        return new string[] { g1, g2 };
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
            _currentGeneration = new Generation1V1(lines);
        } else
        {
            Debug.Log("Current generation File not found mutating default for new generation");
        }
        if(_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
        {
            //Debug.Log("Generating generation from default genomes");
            var mutants = MutationControl.CreateDefaultGeneration();
            _currentGeneration = new Generation1V1(mutants);
        }
        //Debug.Log("_currentGeneration: " + _currentGeneration);
    }
}
