using Assets.Src.Database;
using Assets.Src.Interfaces;
using Assets.Src.Menus;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Assets.Src.Evolution
{
    public class EvolutionController : MonoBehaviour
    {
        #region General
        public int DatabaseId;

        public EvolutionShipConfig ShipConfig;
        public EvolutionConfig EvolutionConfig;

        protected EvolutionMutationWrapper _mutationControl = new EvolutionMutationWrapper();
        protected EvolutionMatchController _matchControl;

        private Generation _currentGeneration;
        #endregion

        #region BR
        private Dictionary<string, GenomeWrapper> _currentGenomes;
        
        private Dictionary<string, GenomeWrapper> _extantTeams;
        private Dictionary<string, float> _teamScores;

        List<string> AllCompetetrs { get { return _currentGenomes.Select(kv => kv.Value.Genome).ToList(); } }

        public RigidbodyList RaceGoals;
        private Rigidbody _raceGoalObject = null;
        private const string RACE_GAOL_TAG = "RaceGoal";
        #endregion

        #region Drone
        private int _droneKillsSoFar = 0;

        private bool _dronesRemain;

        private int _previousDroneCount;
        EvolutionDatabaseHandler _dbHandler;

        public RigidbodyList DroneList;
        private const int DRONES_INDEX = 1;
        private readonly List<Transform> _liveDrones = new List<Transform>();
        #endregion

        public EvolutionDatabaseHandler DbHandler { get; }
        
        public int GenerationNumber { get { return EvolutionConfig.GenerationNumber; } }

        public Rect SummaryBox = new Rect(800, 10, 430, 100);
        
        public string MainMenu = "MainMenu";

        public void Start()
        {
            DatabaseId = ArgumentStore.IdToLoad ?? DatabaseId;

            _dbHandler = new EvolutionDatabaseHandler();

            EvolutionConfig = _dbHandler.ReadConfig(DatabaseId);

            _dbHandler.SetAutoloadId(DatabaseId);

            if (EvolutionConfig == null || EvolutionConfig.DatabaseId != DatabaseId)
            {
                throw new Exception("Did not retrieve expected config from database");
            }

            _matchControl = gameObject.GetComponent<EvolutionMatchController>() ?? gameObject.AddComponent<EvolutionMatchController>();

            _mutationControl.Config = EvolutionConfig.MutationConfig;
            _matchControl.Config = EvolutionConfig.MatchConfig;
            ShipConfig.Config = EvolutionConfig.MatchConfig;

            ReadInGeneration();

            SpawnRaceGoal();

            SpawnShips();

            SpawnDrones();
        }

        public void Update()
        {
            if (Input.GetKeyUp(KeyCode.Escape))
            {
                QuitToMainMenu();
            }
        }

        public void FixedUpdate()
        {
            //Debug.Log("IsMatchOver");
            if (_matchControl.ShouldPollForWinners())
            {
                ProcessDefeatedShips();
                AddRaceScores();

                var matchOver = false;

                var currentDroneCount = CountLiveDrones();             
                _dronesRemain = currentDroneCount > 0;
                var killedDrones = _previousDroneCount - currentDroneCount;
                _previousDroneCount = currentDroneCount;
                
                //TODO reimplement ending early if no ships have any modules
                
                if (_extantTeams.Count == 0)
                {
                    //everyone's dead
                    matchOver = true;
                }
                else
                {
                    AddScoresForKilledDrones(killedDrones);
                    if (_matchControl.IsOutOfTime())
                    {
                        //time over - draw
                        AddScoreSurvivingIndividualsAtTheEnd();
                        matchOver = true;
                    }
                }

                if (matchOver)
                {
                    Debug.Log("Match over!");
                    foreach (var team in _teamScores)
                    {
                        var competitor = _currentGenomes[team.Key];

                        var score = team.Value;
                                                
                        var alive = _extantTeams.ContainsKey(team.Key);

                        _currentGeneration.RecordMatch(competitor, score, alive, !_dronesRemain, _droneKillsSoFar, AllCompetetrs, alive && _extantTeams.Count == 1);
                    }

                    _dbHandler.UpdateGeneration(_currentGeneration, DatabaseId, EvolutionConfig.GenerationNumber);

                    SceneManager.LoadScene(SceneManager.GetActiveScene().name);
                }
            }
        }

        public void OnGUI()
        {
            GUI.Box(SummaryBox, SummaryText());
        }

        #region Initial Setup
        private void ReadInGeneration()
        {
            _currentGeneration = _dbHandler.ReadGeneration(DatabaseId, EvolutionConfig.GenerationNumber);

            if (_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
            {
                //The current generation does not exist - create a new random generation.
                CreateNewGeneration(null);
            }
            else if (_currentGeneration.MinimumMatchesPlayed >= EvolutionConfig.MinMatchesPerIndividual)
            {
                //the current generation is finished - create a new generation
                var winners = _currentGeneration.PickWinners(EvolutionConfig.WinnersFromEachGeneration);

                EvolutionConfig.GenerationNumber++;

                CreateNewGeneration(winners);
            }
            //Debug.Log("_currentGeneration: " + _currentGeneration);
        }

        private void SpawnRaceGoal()
        {
            if (EvolutionConfig.RaceConfig.RaceGoalObject.HasValue && RaceGoals != null && RaceGoals.Modules.Count > EvolutionConfig.RaceConfig.RaceGoalObject.Value)
            {
                var goalPrefab = RaceGoals.Modules[EvolutionConfig.RaceConfig.RaceGoalObject.Value];
                _raceGoalObject = Instantiate(goalPrefab, Vector3.zero, Quaternion.identity);
                _raceGoalObject.tag = RACE_GAOL_TAG;
                var health = _raceGoalObject.GetComponent<HealthControler>();
                if (health != null)
                {
                    health.enabled = false;
                }
            }
        }

        /// <summary>
        /// Chooses the individuals to compete this match and spawns them.
        /// </summary>
        /// <returns>Boolean indecating that something has at least one module</returns>
        private bool SpawnShips()
        {
            var genomes = _currentGeneration.PickCompetitors(EvolutionConfig.BrConfig.NumberOfCombatants);

            var wrappers = new List<GenomeWrapper>();
            _currentGenomes = new Dictionary<string, GenomeWrapper>();

            var names = new List<string>();

            var i = 0;
            foreach (var g in genomes)
            {
                string name = "Nemo";
                for (var j = 0; j < _matchControl.Config.CompetitorsPerTeam; j++)
                {
                    var gw = ShipConfig.SpawnShip(g, i, j, EvolutionConfig.MatchConfig.InSphereRandomisationRadius, EvolutionConfig.MatchConfig.OnSphereRandomisationRadius);
                    wrappers.Add(gw);

                    Debug.Log(gw.Name + " enters the arena!");
                    Debug.Log("Ship cost = " + gw.Cost);

                    name = gw.Name;
                    var hasModules = gw.ModulesAdded > 0;

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

        /// <summary>
        /// Instanciates all the drone prefabs for this match
        /// </summary>
        private void SpawnDrones()
        {
            var completeKillers = _dbHandler.CountCompleteKillers(EvolutionConfig.DatabaseId, EvolutionConfig.GenerationNumber);
            int DroneCount = (int)(EvolutionConfig.EvolutionDroneConfig.MinDronesToSpawn + Math.Floor((double)completeKillers * EvolutionConfig.EvolutionDroneConfig.ExtraDromnesPerGeneration));
            Debug.Log(DroneCount + " drones this match");

            var droneTag = EvolutionConfig.EvolutionDroneConfig.DroneTag;
            var enemyTags = ShipConfig.Tags.Where(t => t != droneTag).ToList();

            for (int i = 0; i < DroneCount; i++)
            {
                var dronePrefab = SelectDrone(i);
                //Debug.Log("spawning drone " + genome);

                var randomPlacement = EvolutionConfig.MatchConfig.PositionForCompetitor(DRONES_INDEX, 0, EvolutionConfig.EvolutionDroneConfig.DronesInSphereRandomRadius, EvolutionConfig.EvolutionDroneConfig.DronesOnSphereRandomRadius);
                var orientation = EvolutionConfig.MatchConfig.OrientationForStartLocation(randomPlacement);
                var drone = Instantiate(dronePrefab, randomPlacement, orientation);
                drone.tag = droneTag;

                drone.velocity = EvolutionConfig.MatchConfig.VelocityForStartLocation(randomPlacement);

                var knower = drone.GetComponent<IKnowsEnemyTags>();
                if (knower != null) knower.KnownEnemyTags = enemyTags;

                _liveDrones.Add(drone.transform);
            }

            _previousDroneCount = DroneCount;
            _dronesRemain = _previousDroneCount > 0;
        }
        
        /// <summary>
        /// Creates and saves a new generation in the database.
        /// If winners are provided, the new generation will be mutatnts of those.
        /// If no winners are provided, the generation number will be reset to 0, and a new default generation will be created.
        /// The current generation is set to the generation that is created.
        /// </summary>
        /// <param name="winners"></param>
        private Generation CreateNewGeneration(IEnumerable<string> winners)
        {
            if (winners != null && winners.Any())
            {
                _currentGeneration = new Generation(_mutationControl.CreateGenerationOfMutants(winners.ToList()));
            }
            else
            {
                Debug.Log("Generating generation from default genomes");
                _currentGeneration = new Generation(_mutationControl.CreateDefaultGeneration());
                EvolutionConfig.GenerationNumber = 0;   //it's always generation 0 for a default genteration.
            }

            _dbHandler.SaveNewGeneration(_currentGeneration, DatabaseId, EvolutionConfig.GenerationNumber);
            _dbHandler.SetCurrentGenerationNumber(DatabaseId, EvolutionConfig.GenerationNumber);

            return _currentGeneration;
        }

        /// <summary>
        /// Choses the correct drone to spawn for hte given index in the list
        /// </summary>
        /// <param name="index"></param>
        /// <returns></returns>
        private Rigidbody SelectDrone(int index)
        {
            var droneIndex = EvolutionConfig.EvolutionDroneConfig.Drones.Any()
                ? EvolutionConfig.EvolutionDroneConfig.Drones[index % EvolutionConfig.EvolutionDroneConfig.Drones.Count]
                : index % DroneList.Modules.Count;
            var dronePrefab = DroneList.Modules[droneIndex];
            return dronePrefab;
        }
        #endregion

        #region Update Methods
        private void QuitToMainMenu()
        {
            DbHandler.SetAutoloadId(null);
            SceneManager.LoadScene(MainMenu);
        }
        #endregion

        #region Fixed Update Methods
        /// <summary>
        /// Works out which individuals are now dead that weren't dead before.
        /// The dead individuals get their scores updated for having died.
        /// The _extantTeams list gets updated to only include the teams that are still alive.
        /// </summary>
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

        /// <summary>
        /// Adds score to each team for every live ship on that team based on how close it is to the race goal.
        /// </summary>
        private void AddRaceScores()
        {
            if (_raceGoalObject != null && EvolutionConfig.RaceConfig.RaceMaxDistance > 0 && EvolutionConfig.RaceConfig.RaceScoreMultiplier != 0)
            {
                foreach (var shipTeam in ShipConfig.ShipTeamMapping.Where(kv => kv.Key != null && kv.Key.IsValid()))
                {
                    var dist = Vector3.Distance(_raceGoalObject.position, shipTeam.Key.position);
                    var unscaledScore = (EvolutionConfig.RaceConfig.RaceMaxDistance - dist) / EvolutionConfig.RaceConfig.RaceMaxDistance;
                    var extraScore = (float)Math.Max(0, unscaledScore * EvolutionConfig.RaceConfig.RaceScoreMultiplier);
                    //if(extraScore > 0) Debug.Log("Race: Distance: " + dist + ", score: " + extraScore + ", team: " + shipTeam.Value);
                    AddScore(shipTeam.Value, extraScore);
                }
            }
        }

        /// <summary>
        /// Returns the number of drones that are still alive
        /// </summary>
        /// <returns></returns>
        private int CountLiveDrones()
        {
            _liveDrones.RemoveAll(t => t.IsInvalid());
            var currentDroneCount = _liveDrones.Count;
            return _liveDrones.Count;
        }

        /// <summary>
        /// Adds the score for the given number of killed drones to every extant team
        /// </summary>
        /// <param name="killedDrones"></param>
        private void AddScoresForKilledDrones(int killedDrones)
        {
            if (killedDrones > 0)
            {
                _droneKillsSoFar += killedDrones;
                var scorePerKill = (_matchControl.RemainingTime() * EvolutionConfig.EvolutionDroneConfig.KillScoreMultiplier) + EvolutionConfig.EvolutionDroneConfig.FlatKillBonus;
                //Debug.Log(killedDrones + " drones killed this interval for " + scorePerKill + " each.");
                var scoreForDroneKills = killedDrones * scorePerKill;
                foreach (var teamTag in _extantTeams.Keys)
                {
                    AddScore(teamTag, scoreForDroneKills);
                }
            }
        }

        private void AddScoreSurvivingIndividualsAtTheEnd()
        {
            Debug.Log("Match over: " + _extantTeams.Count + " survived.");
            var score = EvolutionConfig.BrConfig.SurvivalBonus / _extantTeams.Count;
            foreach (var team in _extantTeams)
            {
                AddScore(team.Key, score);
            }
        }

        protected IEnumerable<Transform> ListShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                    .Where(s =>
                        s.transform.parent != null &&
                        s.transform.parent.GetComponent<Rigidbody>() != null
                    ).Select(s => s.transform.parent);
        }

        private void AddScoreForDefeatedIndividual(KeyValuePair<string, GenomeWrapper> deadIndividual)
        {
            Debug.Log(deadIndividual.Value.Name + " has died");
            var score = -EvolutionConfig.BrConfig.DeathScoreMultiplier * _extantTeams.Count * _matchControl.RemainingTime();
            AddScore(deadIndividual.Key, score);
        }

        private void AddScore(string teamTag, float extraScore)
        {
            _teamScores[teamTag] += extraScore;
        }
        #endregion

        #region On GUI Methods
        protected virtual string SummaryText()
        {
            if(EvolutionConfig == null)
            {
                Debug.LogError($"No config loaded! DatabaseId: {DatabaseId}");
                return "No config loaded!";
            }
            var text = "ID: " + DatabaseId + ", Name: " + EvolutionConfig.RunName + ", Generation: " + EvolutionConfig.GenerationNumber + Environment.NewLine +
                "Combatants: " + string.Join(" vs ", _currentGenomes.Values.Select(g => g.Name));

            var runTimeing = _matchControl.MatchRunTime;
            var matchLength = _matchControl.Config.MatchTimeout;
            var remaining = matchLength - runTimeing;

            text += Environment.NewLine + Math.Round(remaining) + " seconds remaining";

            foreach (var score in _teamScores)
            {
                text += $"{Environment.NewLine} {score.Key} : {score.Value}";
            }

            return text;
        }
        #endregion
    }
}
