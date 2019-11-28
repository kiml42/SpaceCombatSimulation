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

        EvolutionBrDatabaseHandler _dbHandlerBR;

        private bool _hasModules;

        private Dictionary<string, GenomeWrapper> _extantTeams;
        private Dictionary<string, float> _teamScores;

        List<string> AllCompetetrs { get { return _currentGenomes.Select(kv => kv.Value.Genome).ToList(); } }

        public RigidbodyList RaceGoals;
        private Rigidbody _raceGoalObject = null;
        private const string RACE_GAOL_TAG = "RaceGoal";
        #endregion

        #region Drone
        public float CurrentScore = 0;

        private int _killsThisMatch = 0;
        private const int SHIP_INDEX = 0;
        private const int DRONES_INDEX = 1;

        private bool _stillAlive;
        private bool _dronesRemain;

        private int _previousDroneCount;
        EvolutionDroneDatabaseHandler _dbHandlerDrone;

        public RigidbodyList DroneList;

        private GenomeWrapper _genomeWrapper;
        #endregion

        protected IEnumerable<Transform> ListShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                    .Where(s =>
                        s.transform.parent != null &&
                        s.transform.parent.GetComponent<Rigidbody>() != null
                    ).Select(s => s.transform.parent);
        }

        public GeneralDatabaseHandler DbHandler { get; }

        protected BaseEvolutionConfig BaseConfig { get; }

        public int GenerationNumber { get { return BaseConfig.GenerationNumber; } }

        public Rect SummaryBox = new Rect(800, 10, 430, 100);

        public IEnumerable<string> Combatants { get; }

        public string MainMenu = "MainMenu";

        public void Start()
        {
            InitBR();
            InitDrone();
        }

        public void FixedUpdate()
        {
            BRFixedUpdate();
            DroneFixedUpdate();
        }

        #region BR
        // Use this for initialization
        public void InitBR()
        {
            DatabaseId = ArgumentStore.IdToLoad ?? DatabaseId;

            _dbHandlerBR = new EvolutionBrDatabaseHandler();

            EvolutionConfig.BrConfig = _dbHandlerBR.ReadConfig(DatabaseId);

            _dbHandlerBR.SetAutoloadId(DatabaseId);

            if (EvolutionConfig.BrConfig == null || EvolutionConfig.BrConfig.DatabaseId != DatabaseId)
            {
                throw new Exception("Did not retrieve expected config from database");
            }

            _matchControl = gameObject.AddComponent<EvolutionMatchController>();
            
            _mutationControl.Config = EvolutionConfig.BrConfig.MutationConfig;
            _matchControl.Config = EvolutionConfig.BrConfig.MatchConfig;
            ShipConfig.Config = EvolutionConfig.BrConfig.MatchConfig;

            ReadInGeneration();

            SpawnRaceGoal();

            _hasModules = SpawnShips();
        }
        // Update is called once per frame
        public void BRFixedUpdate()
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

                if (_extantTeams.Count == 0)
                {
                    //everyone's dead
                    matchIsOver = true;
                }

                if ((_matchControl.IsOutOfTime() || !_hasModules) || (_extantTeams.Count == 1 && EvolutionConfig.RaceConfig.RaceScoreMultiplier == 0))
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
                    var gw = ShipConfig.SpawnShip(g, i, j, EvolutionConfig.BrConfig.InSphereRandomisationRadius, EvolutionConfig.BrConfig.OnSphereRandomisationRadius);
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
            var score = -EvolutionConfig.BrConfig.DeathScoreMultiplier * _extantTeams.Count * _matchControl.RemainingTime();
            AddScore(deadIndividual.Key, score);
        }

        private void AddScore(string individual, float extraScore)
        {
            _teamScores[individual] += extraScore;
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

        private void ReadInGeneration()
        {
            _currentGeneration = _dbHandlerBR.ReadGeneration(DatabaseId, EvolutionConfig.BrConfig.GenerationNumber);

            if (_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
            {
                //The current generation does not exist - create a new random generation.
                CreateNewGeneration(null);
            }
            else if (_currentGeneration.MinimumMatchesPlayed >= EvolutionConfig.BrConfig.MinMatchesPerIndividual)
            {
                //the current generation is finished - create a new generation
                var winners = _currentGeneration.PickWinners(EvolutionConfig.BrConfig.WinnersFromEachGeneration);

                EvolutionConfig.BrConfig.GenerationNumber++;

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
                EvolutionConfig.BrConfig.GenerationNumber = 0;   //it's always generation 0 for a default genteration.
            }

            _dbHandlerBR.SaveNewGeneration(_currentGeneration, DatabaseId, EvolutionConfig.BrConfig.GenerationNumber);
            _dbHandlerBR.SetCurrentGenerationNumber(DatabaseId, EvolutionConfig.BrConfig.GenerationNumber);

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
                _currentGeneration.RecordMatch(competitor, scoreKv.Value, AllCompetetrs, outcome);
            }
            _dbHandlerBR.UpdateGeneration(_currentGeneration, DatabaseId, EvolutionConfig.BrConfig.GenerationNumber);
        }
        #endregion


        #region Drone
        void InitDrone()
        {
            DatabaseId = ArgumentStore.IdToLoad ?? DatabaseId;

            _dbHandlerDrone = new EvolutionDroneDatabaseHandler();

            EvolutionConfig.EvolutionDroneConfig = _dbHandlerDrone.ReadConfig(DatabaseId);

            _dbHandlerDrone.SetAutoloadId(DatabaseId);

            if (EvolutionConfig.EvolutionDroneConfig == null || EvolutionConfig.DatabaseId != DatabaseId)
            {
                throw new Exception("Did not retrieve expected config from database");
            }

            _matchControl = gameObject.AddComponent<EvolutionMatchController>();

            _mutationControl.Config = EvolutionConfig.MutationConfig;
            _matchControl.Config = EvolutionConfig.MatchConfig;
            ShipConfig.Config = EvolutionConfig.MatchConfig;

            ReadInGenerationDrone();

            _hasModules = SpawnShipsDrone();

            IsMatchOver();
        }

        // Update is called once per frame
        void DroneFixedUpdate()
        {
            if (Input.GetKeyUp(KeyCode.Escape))
            {
                QuitToMainMenu();
            }
            var matchOver = IsMatchOver();
            if (matchOver || _matchControl.IsOutOfTime())
            {
                var survivalBonus = _matchControl.RemainingTime() * (_stillAlive
                    ? EvolutionConfig.EvolutionDroneConfig.CompletionBonus
                    : -EvolutionConfig.EvolutionDroneConfig.DeathPenalty);

                Debug.Log("Match over! Score for kills: " + CurrentScore + ", Survival Bonus: " + survivalBonus);

                CurrentScore += survivalBonus;

                _currentGeneration.RecordMatch(_genomeWrapper, CurrentScore, _stillAlive, !_dronesRemain, _killsThisMatch);

                //save the current generation
                _dbHandlerDrone.UpdateGeneration(_currentGeneration, DatabaseId, EvolutionConfig.GenerationNumber);

                SceneManager.LoadScene(SceneManager.GetActiveScene().name);
            }
        }

        private bool SpawnShipsDrone()
        {
            var genome = _currentGeneration.PickCompetitor();

            for (var j = 0; j < _matchControl.Config.CompetitorsPerTeam; j++)
            {
                _genomeWrapper = ShipConfig.SpawnShip(genome, SHIP_INDEX, 0, EvolutionConfig.EvolutionDroneConfig.ShipInSphereRandomRadius, EvolutionConfig.EvolutionDroneConfig.ShipOnSphereRandomRadius);
            }

            Debug.Log(_genomeWrapper.Name + " enters the arena!");
            Debug.Log("Ship cost = " + _genomeWrapper.Cost);

            SpawnDrones();

            return _genomeWrapper.ModulesAdded > 0;
        }

        private void SpawnDrones()
        {
            var completeKillers = _dbHandlerDrone.CountCompleteKillers(EvolutionConfig.DatabaseId, EvolutionConfig.GenerationNumber);
            var DroneCount = EvolutionConfig.EvolutionDroneConfig.MinDronesToSpawn + Math.Floor((double)completeKillers * EvolutionConfig.EvolutionDroneConfig.ExtraDromnesPerGeneration);
            Debug.Log(DroneCount + " drones this match");

            var droneTag = ShipConfig.GetTag(DRONES_INDEX);
            var enemyTags = ShipConfig.Tags.Where(t => t != droneTag).ToList();

            for (int i = 0; i < DroneCount; i++)
            {
                var dronePrefab = SelectDrone(i);
                //Debug.Log("spawning drone " + genome);

                var randomPlacement = EvolutionConfig.MatchConfig.PositionForCompetitor(DRONES_INDEX, 0, EvolutionConfig.EvolutionDroneConfig.DronesInSphereRandomRadius, EvolutionConfig.EvolutionDroneConfig.DronesOnSphereRandomRadius);
                var orientation = EvolutionConfig.MatchConfig.OrientationForStartLocation(randomPlacement);
                var ship = Instantiate(dronePrefab, randomPlacement, orientation);
                ship.tag = droneTag;

                ship.velocity = EvolutionConfig.MatchConfig.VelocityForStartLocation(randomPlacement);

                var knower = ship.GetComponent<IKnowsEnemyTags>();
                if (knower != null) knower.KnownEnemyTags = enemyTags;
            }
        }

        private Rigidbody SelectDrone(int index)
        {
            var droneIndex = EvolutionConfig.EvolutionDroneConfig.Drones.Any()
                ? EvolutionConfig.EvolutionDroneConfig.Drones[index % EvolutionConfig.EvolutionDroneConfig.Drones.Count]
                : index % DroneList.Modules.Count;
            var dronePrefab = DroneList.Modules[droneIndex];
            return dronePrefab;
        }

        /// <summary>
        /// Updates the score based on the remaining ships.
        /// Returns a true if the match is over because one team is wiped out.
        /// </summary>
        /// <returns>Match is over boolean</returns>
        private bool IsMatchOver()
        {
            //Debug.Log("IsMatchOver");
            if (_matchControl.ShouldPollForWinners())
            {
                var tags = ListShips()
                    .Select(s => s.tag);

                var shipCount = tags.Count(t => t == ShipConfig.Tags[SHIP_INDEX]);
                var droneCount = tags.Count(t => t == ShipConfig.Tags[DRONES_INDEX]);

                _dronesRemain = droneCount > 0;
                _stillAlive = _hasModules && shipCount > 0; //ships that never had modules are considered dead.
                if (!_hasModules)
                {
                    Debug.Log("Ship spawned no modules - it is dead to me.");
                }

                var killedDrones = _previousDroneCount - droneCount;

                //Debug.Log(shipCount + " ship modules, " + droneCount + " drones still alive. (" + _previousDroneCount + " prev) " + _genome);
                if (killedDrones > 0)
                {
                    _killsThisMatch += killedDrones;
                    var scorePerKill = (_matchControl.RemainingTime() * EvolutionConfig.EvolutionDroneConfig.KillScoreMultiplier) + EvolutionConfig.EvolutionDroneConfig.FlatKillBonus;
                    //Debug.Log(killedDrones + " drones killed this interval for " + scorePerKill + " each.");
                    CurrentScore += killedDrones * scorePerKill;
                }
                _previousDroneCount = droneCount;

                return !_stillAlive || !_dronesRemain;
            }
            return false;
        }

        private void ReadInGenerationDrone()
        {
            _currentGeneration = _dbHandlerDrone.ReadGeneration(DatabaseId, EvolutionConfig.GenerationNumber);

            if (_currentGeneration == null || _currentGeneration.CountIndividuals() < 2)
            {
                //The current generation does not exist - create a new random generation.
                CreateNewGenerationDrone(null);
            }
            else if (_currentGeneration.MinimumMatchesPlayed >= EvolutionConfig.MinMatchesPerIndividual)
            {
                //the current generation is finished - create a new generation
                var winners = _currentGeneration.PickWinners(EvolutionConfig.WinnersFromEachGeneration);

                EvolutionConfig.GenerationNumber++;

                CreateNewGenerationDrone(winners);
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
        private Generation CreateNewGenerationDrone(IEnumerable<string> winners)
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

            _dbHandlerDrone.SaveNewGeneration(_currentGeneration, DatabaseId, EvolutionConfig.GenerationNumber);
            _dbHandlerDrone.SetCurrentGenerationNumber(DatabaseId, EvolutionConfig.GenerationNumber);

            return _currentGeneration;
        }
        #endregion

        protected void QuitToMainMenu()
        {
            DbHandler.SetAutoloadId(null);
            SceneManager.LoadScene(MainMenu);
        }

        private void OnGUI()
        {
            GUI.Box(SummaryBox, SummaryText());
        }

        protected virtual string SummaryText()
        {
            var text = "ID: " + DatabaseId + ", Name: " + BaseConfig.RunName + ", Generation: " + BaseConfig.GenerationNumber + Environment.NewLine +
                "Combatants: " + string.Join(" vs ", Combatants.ToArray());

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
    }
}
