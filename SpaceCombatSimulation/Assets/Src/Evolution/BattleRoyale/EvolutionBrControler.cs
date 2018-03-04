using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;
using System.IO;
using Assets.Src.ObjectManagement;
using Assets.Src.Database;
using Assets.Src.Evolution;
using Assets.Src.Menus;

public class EvolutionBrControler : BaseEvolutionController
{
    EvolutionBrConfig _config;
    
    private Dictionary<string, GenomeWrapper> _currentGenomes;
    
    private GenerationBr _currentGeneration;

    EvolutionBrDatabaseHandler _dbHandler;

    // Use this for initialization
    void Start()
    {
        DatabaseId = ArgumentStore.IdToLoad ?? DatabaseId;

        _dbHandler = new EvolutionBrDatabaseHandler();

        _config = _dbHandler.ReadConfig(DatabaseId);

        if(_config == null || _config.DatabaseId != DatabaseId)
        {
            throw new Exception("Did not retrieve expected config from database");
        }
        
        _matchControl = gameObject.AddComponent<EvolutionMatchController>();

        _mutationControl.Config = _config.MutationConfig;
        _matchControl.Config = _config.MatchConfig;
        ShipConfig.Config = _config.MatchConfig;

        ReadInGeneration();

        _hasModules = SpawnShips();
    }

    // Update is called once per frame
    void Update()
    {
        var winningGenome = DetectVictorsGenome();
        if (winningGenome == null && !_matchControl.IsOutOfTime())
        {
            return;
        }
        else if (_matchControl.IsOutOfTime()/* && _previousWinner == null*/)
        {
            //Debug.Log("Match Timeout!");
            ActivateSuddenDeath();
        }

        if (winningGenome != null)
        {
            var a = _currentGenomes.Values.First();
            var b = _currentGenomes.Values.Skip(1).First();

            var winScore = Math.Max(_matchControl.RemainingTime(), _config.SuddenDeathReloadTime);

            var losScore = -_config.SuddenDeathReloadTime;
            var drawScore = -_config.SuddenDeathReloadTime /2;

            _currentGeneration.RecordMatch(a, b, winningGenome, winScore, losScore, drawScore);

            _dbHandler.UpdateGeneration(_currentGeneration, DatabaseId, _config.GenerationNumber);

            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
    }

    private void ActivateSuddenDeath()
    {
        //Debug.Log("Sudden Death!");
        var ships = ListShips();
        foreach (var ship in ships)
        {
            ship.transform.SendMessage("ApplyDamage", _config.SuddenDeathDamage, SendMessageOptions.DontRequireReceiver);
        }
        
        _matchControl.MatchRunTime = _matchControl.Config.MatchTimeout - _config.SuddenDeathReloadTime;
    }
    
    /// <summary>
    /// 
    /// </summary>
    /// <returns>Boolean indecating that something has at least one module</returns>
    private bool SpawnShips()
    {
        var genomes = _currentGeneration.PickCompetitors(_config.NumberOfCombatants);
        
        var wrappers = new List<GenomeWrapper>();
        _currentGenomes = new Dictionary<string, GenomeWrapper>();

        var names = new List<string>();

        var i = 0;
        foreach (var g in genomes)
        {
            string name = "Nemo";
            for(var j=0; j < _matchControl.Config.CompetitorsPerTeam; j++)
            {
                var gw = ShipConfig.SpawnShip(g, i, j);
                wrappers.Add(gw);

                name = gw.GetName();

                _currentGenomes[ShipConfig.GetTag(i)] = gw; //This will only save the last gw, but they should be functionally identical.
            }

            names.Add(name);

            i++;
        }

        Debug.Log("\"" + string.Join("\" vs \"", names.ToArray()) + "\"");

        return wrappers.Any(w => w.ModulesAdded > 0);
    }
    
    public string _previousWinner;
    private bool _hasModules;

    /// <summary>
    /// Returns the genome of the victor.
    /// Or null if there's no victor yet.
    /// Or empty string if everyone's dead.
    /// </summary>
    /// <returns></returns>
    private string DetectVictorsGenome()
    {
        if (_matchControl.ShouldPollForWinners())
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
                var winningGW = _currentGenomes[winningTag];
                if(winningGW != null)
                {
                    currentWinner = winningGW.Genome;
                }
            }
            if (tags.Count() == 0 || !_hasModules)
            {
                //Treat them both as dead if nthing has modules.
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
    
    private void ReadInGeneration()
    {
        _currentGeneration = _dbHandler.ReadGeneration(DatabaseId, _config.GenerationNumber);

        if (_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
        {
            //The current generation does not exist - create a new random generation.
            CreateNewGeneration(null);
        }
        else if (_currentGeneration.MinimumMatchesPlayed >= _config.MinMatchesPerIndividual)
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
    private GenerationBr CreateNewGeneration(IEnumerable<string> winners)
    {
        if (winners != null && winners.Any())
        {
            _currentGeneration = new GenerationBr(_mutationControl.CreateGenerationOfMutants(winners.ToList()));
        }
        else
        {
            Debug.Log("Generating generation from default genomes");
            _currentGeneration = new GenerationBr(_mutationControl.CreateDefaultGeneration());
            _config.GenerationNumber = 0;   //it's always generation 0 for a default genteration.
        }

        _dbHandler.SaveNewGeneration(_currentGeneration, DatabaseId, _config.GenerationNumber);
        _dbHandler.SetCurrentGenerationNumber(DatabaseId, _config.GenerationNumber);

        return _currentGeneration;
    }
}
