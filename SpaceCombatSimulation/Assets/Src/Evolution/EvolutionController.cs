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

        public EvolutionDatabaseHandler DbHandler { get; private set; }
        #endregion

        #region BR
        /// <summary>
        /// list of the genomes that were spawned at the start of this match keyed by the team they are on.
        /// </summary>
        private Dictionary<string, GenomeWrapper> _genomesInThisMatch;
        
        private Dictionary<string, GenomeWrapper> _extantTeams;
        private Dictionary<string, Score> _teamScores;

        List<string> AllCompetetrs { get { return _genomesInThisMatch.Select(kv => kv.Value.Genome).ToList(); } }

        public RigidbodyList RaceGoals;
        private Rigidbody _raceGoalObject = null;
        private const string RACE_GAOL_TEAM = "RaceGoal";
        #endregion

        #region Drone
        private int _droneKillsSoFar = 0;

        private bool _dronesRemain;

        private int _previousDroneCount;
        public RigidbodyList DroneList;
        private readonly List<Transform> _liveDrones = new List<Transform>();
        #endregion


        public int GenerationNumber { get { return EvolutionConfig.GenerationNumber; } }

        public Rect SummaryBox = new Rect(800, 10, 430, 100);
        
        public string MainMenu = "MainMenu";

        #region Player Ship
        public bool AddPlayerShip;

        public Rigidbody PlayerShip; 
        #endregion

        public void Start()
        {
            DatabaseId = ArgumentStore.IdToLoad ?? DatabaseId;

            DbHandler = new EvolutionDatabaseHandler();

            EvolutionConfig = DbHandler.ReadConfig(DatabaseId);

            DbHandler.SetAutoloadId(DatabaseId);

            if (EvolutionConfig == null || EvolutionConfig.DatabaseId != DatabaseId)
            {
                throw new Exception("Did not retrieve expected config from database");
            }

            _matchControl = gameObject.GetComponent<EvolutionMatchController>();
            if(_matchControl == null)
            {
                _matchControl = gameObject.AddComponent<EvolutionMatchController>();
            }

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
                        var competitor = _genomesInThisMatch[team.Key];

                        var score = team.Value;
                                                
                        var alive = _extantTeams.ContainsKey(team.Key);

                        _currentGeneration.RecordMatch(competitor, score.Total, alive, !_dronesRemain, _droneKillsSoFar, AllCompetetrs, alive && _extantTeams.Count == 1);
                    }

                    DbHandler.UpdateGeneration(_currentGeneration, DatabaseId, EvolutionConfig.GenerationNumber);

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
            _currentGeneration = DbHandler.ReadGeneration(DatabaseId, EvolutionConfig.GenerationNumber);

            if (_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
            {
                //The current generation does not exist - create a new random generation.
                CreateNewGeneration(null);
            }
            else if (_currentGeneration.MinimumMatchesPlayed >= EvolutionConfig.MinMatchesPerIndividual)
            {
                //the current generation is finished - create a new generation
                var winners = _currentGeneration.PickWinners(EvolutionConfig.WinnersFromEachGeneration);
                var persistants = _currentGeneration.PickWinners(EvolutionConfig.WinnersFromEachGeneration/2);  //todo define this proportion somewhere better.

                EvolutionConfig.GenerationNumber++;

                CreateNewGeneration(winners, persistants);
            }
            //Debug.Log("_currentGeneration: " + _currentGeneration);
        }

        private void SpawnRaceGoal()
        {
            if (EvolutionConfig.RaceConfig.RaceGoalObject.HasValue && RaceGoals != null && RaceGoals.Modules.Count > EvolutionConfig.RaceConfig.RaceGoalObject.Value)
            {
                var goalPrefab = RaceGoals.Modules[EvolutionConfig.RaceConfig.RaceGoalObject.Value];
                _raceGoalObject = Instantiate(goalPrefab, Vector3.zero, Quaternion.identity);
                _raceGoalObject.GetComponent<ITarget>().SetTeam(RACE_GAOL_TEAM);
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
        protected virtual bool SpawnShips()
        {
            var genomes = _currentGeneration.PickCompetitors(EvolutionConfig.BrConfig.NumberOfCombatants);

            var wrappers = new List<GenomeWrapper>();
            _genomesInThisMatch = new Dictionary<string, GenomeWrapper>();

            var names = new List<string>();

            Debug.Log($"Picking {EvolutionConfig.BrConfig.NumberOfCombatants} competitors for match. Aiming for {EvolutionConfig.MinMatchesPerIndividual} matches each.");
            var i = 0;
            foreach (var g in genomes)
            {
                string name = "Nemo";
                for (var j = 0; j < _matchControl.Config.CompetitorsPerTeam; j++)
                {
                    var gw = ShipConfig.SpawnShip(g, i, EvolutionConfig.BrConfig.NumberOfCombatants, j);
                    wrappers.Add(gw);

                    Debug.Log($"{gw.Name} enters the arena on team {gw.Team}! Ship cost = " + gw.Cost);

                    name = gw.Name;
                    var hasModules = gw.ModulesAdded > 0;

                    _genomesInThisMatch[gw.Team] = gw; //This will only save the last gw, but they should be functionally identical.
                }

                names.Add(name);

                i++;
            }

            _extantTeams = _genomesInThisMatch;
            _teamScores = _genomesInThisMatch.ToDictionary(kv => kv.Key, _ => new Score());

            foreach (var teamTransform in ShipConfig.ShipTeamMapping)
            {
                var ship = teamTransform.Key;
                var team = teamTransform.Value;

                var tagSource = ship.GetComponent<IKnowsEnemyTags>();
                if (tagSource != null)
                {
                    var enemyTags = ShipConfig.ShipTeamMapping.Values.Where(t => t != team).ToList();
                    enemyTags.AddRange(ShipConfig.TagsForAll);
                    tagSource.KnownEnemyTags = enemyTags;
                }
                else
                {
                    Debug.LogError(ship.name + " Has no IKnowsEnemyTags available.");
                }
            }

            Debug.Log("\"" + string.Join("\" vs \"", names.Distinct().ToArray()) + "\"");

            if (AddPlayerShip)
            {
                SpawnPlayerShip();
            }

            return wrappers.Any(w => w.ModulesAdded > 0);
        }

        protected void SpawnPlayerShip()
        {
            var teams = ShipConfig.ShipTeamMapping.Values.ToList();
            teams.AddRange(ShipConfig.TagsForAll.Where(t => t != "RaceGoal"));

            var location = EvolutionConfig.MatchConfig.RandomLocation(EvolutionConfig.EvolutionDroneConfig.DronesInSphereRandomRadius, EvolutionConfig.EvolutionDroneConfig.DronesOnSphereRandomRadius);
            var ship = Instantiate(PlayerShip, location, Quaternion.identity);
            var playerTagKnowers = ship.GetComponentsInChildren<IKnowsEnemyTags>();
            var shipTarget = ship.GetComponentInChildren<ITarget>();
            shipTarget.SetTeam("Player1");

            foreach (var tk in playerTagKnowers)
            {
                tk.KnownEnemyTags = teams;
            }

            foreach (var aiShip in ShipConfig.ShipTeamMapping.Keys)
            {
                var EnemyTagKnowers = aiShip.GetComponentsInChildren<IKnowsEnemyTags>();
                foreach (var t in EnemyTagKnowers)
                {
                    t.KnownEnemyTags.Add("Player1");
                }
            }

            var timeDialation = GetComponent<TimeDialationControler>();
            timeDialation.AutoSetTimeScale = false;
        }

        /// <summary>
        /// Instanciates all the drone prefabs for this match
        /// </summary>
        private void SpawnDrones()
        {
            var completeKillers = DbHandler.CountCompleteKillers(EvolutionConfig.DatabaseId, EvolutionConfig.GenerationNumber);
            int DroneCount = (int)(EvolutionConfig.EvolutionDroneConfig.MinDronesToSpawn + Math.Floor((double)completeKillers * EvolutionConfig.EvolutionDroneConfig.ExtraDromnesPerGeneration));
            Debug.Log(DroneCount + " drones this match");

            var droneTeam = EvolutionConfig.EvolutionDroneConfig.DroneTeam;
            var enemyTags = ShipConfig.ShipTeamMapping.Values.Distinct().Where(t => t != droneTeam).ToList();

            for (int i = 0; i < DroneCount; i++)
            {
                var dronePrefab = SelectDrone(i);
                //Debug.Log("spawning drone " + genome);

                var randomPlacement = EvolutionConfig.MatchConfig.RandomLocation(EvolutionConfig.EvolutionDroneConfig.DronesInSphereRandomRadius, EvolutionConfig.EvolutionDroneConfig.DronesOnSphereRandomRadius);
                var orientation = EvolutionConfig.MatchConfig.OrientationForStartLocation(randomPlacement);
                var drone = Instantiate(dronePrefab, randomPlacement, orientation);
                drone.GetComponent<ITarget>().SetTeam(droneTeam);

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
        private Generation CreateNewGeneration(IEnumerable<string> winners, IEnumerable<string> persistentGenomes = null)
        {
            if (winners != null && winners.Any())
            {
                _currentGeneration = new Generation(_mutationControl.CreateGenerationOfMutants(winners.ToList(), persistentGenomes.ToList()));
            }
            else
            {
                Debug.Log("Generating generation from default genomes");
                _currentGeneration = new Generation(_mutationControl.CreateDefaultGeneration());
                EvolutionConfig.GenerationNumber = 0;   //it's always generation 0 for a default genteration.
            }

            DbHandler.SaveNewGeneration(_currentGeneration, DatabaseId, EvolutionConfig.GenerationNumber);
            DbHandler.SetCurrentGenerationNumber(DatabaseId, EvolutionConfig.GenerationNumber);

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
            var liveTeams = ListTeamsWithLiveShips();
            var liveCompetitorTeams = liveTeams
                .Where(t => _extantTeams.Keys.Contains(t));
            //Debug.Log($"{tags.Count()} teams still exist: {string.Join(", ", tags)}");

            if (liveCompetitorTeams.Count() < _extantTeams.Count)
            {
                //Something's died.
                var deadGenomes = _extantTeams.Where(kv => !liveCompetitorTeams.Contains(kv.Key));
                foreach (var dead in deadGenomes)
                {
                    AddScoreForDefeatedIndividual(dead);
                }

                _extantTeams = _genomesInThisMatch.Where(kv => liveCompetitorTeams.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
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
                    if (extraScore != 0)
                    {
                        AddScore(shipTeam.Value, ScoreType.Race, extraScore);
                    }
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
                Debug.Log($"DronesKilled: {killedDrones}");
                _droneKillsSoFar += killedDrones;
                var scorePerKill = (_matchControl.RemainingTime() * EvolutionConfig.EvolutionDroneConfig.KillScoreMultiplier) + EvolutionConfig.EvolutionDroneConfig.FlatKillBonus;
                //Debug.Log(killedDrones + " drones killed this interval for " + scorePerKill + " each.");
                var scoreForDroneKills = killedDrones * scorePerKill;
                foreach (var teamTag in _extantTeams.Keys)
                {
                    AddScore(teamTag, ScoreType.Drone, scoreForDroneKills);
                }
            }
        }

        private void AddScoreSurvivingIndividualsAtTheEnd()
        {
            Debug.Log("Match over: " + _extantTeams.Count + " survived.");
            var score = EvolutionConfig.BrConfig.SurvivalBonus / _extantTeams.Count;
            foreach (var team in _extantTeams.Keys)
            {
                AddScore(team, ScoreType.Survival, score);
            }
        }

        protected IEnumerable<string> ListTeamsWithLiveShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                .Select(s => s.transform.GetComponentInParent<ITarget>())
                .Where(t => t != null)
                .Select(t => t.Team)
                .Where(t => t != null)
                .Distinct();
        }

        private void AddScoreForDefeatedIndividual(KeyValuePair<string, GenomeWrapper> deadIndividual)
        {
            Debug.Log($"{deadIndividual.Key} has died");
            var score = -EvolutionConfig.BrConfig.DeathScoreMultiplier * _extantTeams.Count * _matchControl.RemainingTime();
            AddScore(deadIndividual.Key, ScoreType.Death, score);
        }

        private void AddScore(string teamTag, ScoreType type, float extraScore)
        {
            //if (extraScore != 0)
            //{
            //    Debug.Log($"{type}: Adding {extraScore} to {teamTag}");
            //}
            _teamScores[teamTag].AddScore(type, extraScore);
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
            var text = $"ID: {DatabaseId}, Name: {EvolutionConfig.RunName}, Generation: {EvolutionConfig.GenerationNumber}{Environment.NewLine}";

            var runTimeing = _matchControl.MatchRunTime;
            var matchLength = _matchControl.Config.MatchTimeout;
            var remaining = matchLength - runTimeing;

            text += Environment.NewLine + Math.Round(remaining) + " seconds remaining" ;
            text += $"{Environment.NewLine} Time Scale : {Time.timeScale}{Environment.NewLine}{Environment.NewLine}";

            if(_teamScores != null)
            {
                text += string.Join(
                    Environment.NewLine,
                    _teamScores.OrderByDescending(t => t.Value).Select(s => $"{s.Key} : {s.Value}")
                    );
            }
            else
            {
                Debug.LogWarning("Team scores is null!");
            }


            return text;
        }
        #endregion

        //TODO make this protected when the player evolution is fitted into a hierarchy
        private class Score : IComparable
        {
            private readonly Dictionary<ScoreType, float> _scoreByType = new Dictionary<ScoreType, float>();

            public float Total => _scoreByType.Sum(kv => kv.Value);

            public void AddScore(ScoreType type, float score)
            {
                if (!_scoreByType.ContainsKey(type))
                {
                    _scoreByType[type] = 0;
                }
                _scoreByType[type] += score;
            }

            public int CompareTo(object obj)
            {
                if (obj is Score otherScore)
                    return this.Total.CompareTo(otherScore.Total);
                return this.Total.CompareTo(obj);
            }

            public override string ToString()
            {
                return Total + " - (" + string.Join(", ", _scoreByType.OrderBy(kv => (int)kv.Key).Select(kv => kv.Key + ":" + Math.Round(kv.Value))) + ")";
            }
        }

        private enum ScoreType : int
        {
            Death,
            Survival,
            Race,
            Drone
        }
    }
}
