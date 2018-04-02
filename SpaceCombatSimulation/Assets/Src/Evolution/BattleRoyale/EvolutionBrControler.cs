using Assets.src.Evolution;
using Assets.Src.Database;
using Assets.Src.Evolution;
using Assets.Src.Menus;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;

public class EvolutionBrControler : BaseEvolutionController
{
    EvolutionBrConfig _config;
    
    private Dictionary<string, GenomeWrapper> _currentGenomes;
    
    private GenerationBr _currentGeneration;

    EvolutionBrDatabaseHandler _dbHandler;
    
    private bool _hasModules;

    private Dictionary<string, GenomeWrapper> _extantTeams;
    public float WinBonus = 1000;

    List<string> _allCompetetrs { get { return _currentGenomes.Select(kv => kv.Value.Genome).ToList(); } }

    protected override GeneralDatabaseHandler _dBHandler
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
        bool matchIsOver = false;
        if (_matchControl.ShouldPollForWinners() || _matchControl.IsOutOfTime() || !_hasModules)
        {
            ProcessDefeatedShips();
            if(_extantTeams.Count == 1)
            {
                //we have a winner
                AddScoreForWinner(_extantTeams.Single());
                matchIsOver = true;
            }
            if(_extantTeams.Count == 0)
            {
                //everyone's dead
                matchIsOver = true;
            }
            if (_matchControl.IsOutOfTime() || !_hasModules)
            {
                //time over - draw
                //or noone has any modules, so treat it as a draw.
                AddScoreSurvivingIndividualsAtTheEnd();
                matchIsOver = true;
            }

            if (matchIsOver)
            {
                _dbHandler.UpdateGeneration(_currentGeneration, DatabaseId, _config.GenerationNumber);

                SceneManager.LoadScene(SceneManager.GetActiveScene().name);
            }
        }
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
                var gw = ShipConfig.SpawnShip(g, i, j, _config.InSphereRandomisationRadius, _config.OnSphereRandomisationRadius);
                wrappers.Add(gw);

                name = gw.Name;

                _currentGenomes[ShipConfig.GetTag(i)] = gw; //This will only save the last gw, but they should be functionally identical.
            }

            names.Add(name);

            i++;
        }

        _extantTeams = _currentGenomes;

        Debug.Log("\"" + string.Join("\" vs \"", names.ToArray()) + "\"");

        return wrappers.Any(w => w.ModulesAdded > 0);
    }

    private void ProcessDefeatedShips()
    {
        var tags = ListShips()
            .Select(s => s.tag)
            .Distinct();
        //Debug.Log(tags.Count() + " teams still exist");

        if (tags.Count() < _extantTeams.Count)
        {
            //Something's died.
            var deadGenomes = _extantTeams.Where(kv => !tags.Contains(kv.Key));
            foreach (var dead in deadGenomes)
            {
                AddScoreForDefeatedIndividual(dead);
            }

            _extantTeams = _currentGenomes.Where(kv => tags.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
        }
    }

    private void AddScoreForDefeatedIndividual(KeyValuePair<string, GenomeWrapper> deadIndividual)
    {
        Debug.Log(deadIndividual.Value.Name + " has died");
        var score = -_extantTeams.Count * _matchControl.RemainingTime();
        _currentGeneration.RecordMatch(deadIndividual.Value, score, _allCompetetrs, MatchOutcome.Loss);
    }

    private void AddScoreForWinner(KeyValuePair<string, GenomeWrapper> winner)
    {
        Debug.Log(winner.Value.Name + " Wins!");
        var score = _matchControl.RemainingTime() + WinBonus;
        _currentGeneration.RecordMatch(winner.Value, score, _allCompetetrs, MatchOutcome.Win);
    }

    private void AddScoreSurvivingIndividualsAtTheEnd()
    {
        Debug.Log("Match over: Draw. " + _extantTeams.Count + " survived.");
        var score = WinBonus / (2 * _extantTeams.Count);
        foreach (var team in _extantTeams)
        {
            _currentGeneration.RecordMatch(team.Value, score, _allCompetetrs, MatchOutcome.Draw);
        }
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
