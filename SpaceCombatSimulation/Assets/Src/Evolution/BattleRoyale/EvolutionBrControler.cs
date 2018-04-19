using Assets.src.Evolution;
using Assets.Src.Database;
using Assets.Src.Evolution;
using Assets.Src.Menus;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;
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
    private Dictionary<string, float> _teamScores;

    List<string> _allCompetetrs { get { return _currentGenomes.Select(kv => kv.Value.Genome).ToList(); } }

    public RigidbodyList RaceGoals;
    private Rigidbody _raceGoalObject = null;

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
            return _currentGenomes.Values.Select(g => g.Species);
        }
    }

    // Use this for initialization
    void Start()
    {
        DatabaseId = ArgumentStore.IdToLoad ?? DatabaseId;

        _dbHandler = new EvolutionBrDatabaseHandler();

        _config = _dbHandler.ReadConfig(DatabaseId);

        _dbHandler.SetAutoloadId(DatabaseId);

        if(_config == null || _config.DatabaseId != DatabaseId)
        {
            throw new Exception("Did not retrieve expected config from database");
        }
        
        _matchControl = gameObject.AddComponent<EvolutionMatchController>();

        _mutationControl.Config = _config.MutationConfig;
        _matchControl.Config = _config.MatchConfig;
        ShipConfig.Config = _config.MatchConfig;

        ReadInGeneration();

        SpawnRaceGoal();

        _hasModules = SpawnShips();
    }

    // Update is called once per frame
    void Update()
    {
        if (Input.GetKeyUp(KeyCode.Escape))
        {
            QuitToMainMenu();
        }
        bool matchIsOver = false;
        if (_matchControl.ShouldPollForWinners() || _matchControl.IsOutOfTime() || !_hasModules)
        {
            AddRaceScores();
            ProcessDefeatedShips();

            if(_extantTeams.Count == 0)
            {
                //everyone's dead
                matchIsOver = true;
            }

            if( (_matchControl.IsOutOfTime() || !_hasModules) || (_extantTeams.Count == 1 && _config.RaceScoreMultiplier == 0))
            {
                //time over - draw
                //or noone has any modules, so treat it as a draw.
                AddScoreSurvivingIndividualsAtTheEnd();
                matchIsOver = true;
            }

            if (matchIsOver)
            {
                SaveScores();
                SceneManager.LoadScene(SceneManager.GetActiveScene().name);
            }
        }
    }

    private void AddRaceScores()
    {
        if(_raceGoalObject != null && _config.RaceMaxDistance > 0 && _config.RaceScoreMultiplier != 0)
        {
            foreach (var shipTeam in ShipConfig.ShipTeamMapping.Where(kv=>kv.Key != null && kv.Key.IsValid()))
            {
                var dist = Vector3.Distance(_raceGoalObject.position, shipTeam.Key.position);
                var unscaledScore = (_config.RaceMaxDistance - dist) / _config.RaceMaxDistance;
                var extraScore = (float)Math.Max(0, unscaledScore * _config.RaceScoreMultiplier);
                if(extraScore > 0) Debug.Log("Race: Distance: " + dist + ", score: " + extraScore + ", team: " + shipTeam.Value);
                AddScore(shipTeam.Value, extraScore);
            }
        }
    }

    /// <summary>
    /// Chooses the individuals to compete this match and spawns them.
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
        _teamScores = _currentGenomes.ToDictionary(kv => kv.Key, kv => 0f);

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
        var score = -_config.DeathScoreMultiplier * _extantTeams.Count * _matchControl.RemainingTime();
        AddScore(deadIndividual.Key, score);
    }

    private void AddScore(string individual, float extraScore)
    {
        _teamScores[individual] += extraScore;
    }

    private void AddScoreSurvivingIndividualsAtTheEnd()
    {
        Debug.Log("Match over: " + _extantTeams.Count + " survived.");
        var score = _config.SurvivalBonus / _extantTeams.Count;
        foreach (var team in _extantTeams)
        {
            AddScore(team.Key, score);
        }
    }

    private void SpawnRaceGoal()
    {
        if (_config.RaceGoalObject.HasValue && RaceGoals != null && RaceGoals.Modules.Count > _config.RaceGoalObject.Value)
        {
            var goalPrefab = RaceGoals.Modules[_config.RaceGoalObject.Value];
            _raceGoalObject = Instantiate(goalPrefab, Vector3.zero, Quaternion.identity);
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

    private void SaveScores()
    {
        foreach (var scoreKv in _teamScores)
        {
            var competitor = _currentGenomes[scoreKv.Key];
            var alive = _extantTeams.ContainsKey(scoreKv.Key);
            var outcome = alive
                ? _extantTeams.Count == 1
                    ? MatchOutcome.Win
                    : MatchOutcome.Draw
                : MatchOutcome.Loss;
            _currentGeneration.RecordMatch(competitor, scoreKv.Value, _allCompetetrs, outcome);
        }
        _dbHandler.UpdateGeneration(_currentGeneration, DatabaseId, _config.GenerationNumber);
    }
}
