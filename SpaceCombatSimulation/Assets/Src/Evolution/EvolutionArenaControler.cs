using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class EvolutionArenaControler : MonoBehaviour
    {
        public EvolutionShipConfig ShipConfig;
        public EvolutionMutationWrapper MutationControl;

        public string FilePath = "./tmp/evolvingShipsArena/evolvingShipsArena.csv";

        public int ConcurrentShips = 5;

        public float MatchCountdown;
        public bool SetVelocity;
        public string DefaultGenome = "";

        public Rigidbody SuddenDeathObject;
        public int SuddenDeathObjectReloadTime = 200;

        private List<ArenaRecord> records = new List<ArenaRecord>();

        private float _originalCountdown;
        private Dictionary<string, string> _extantGenomes;


        // Use this for initialization
        void Start()
        {
            _originalCountdown = MatchCountdown;
            ReadPreviousMatches();
            SpawnInitialShips();
        }

        // Update is called once per frame
        void FixedUpdate()
        {
            DetectSurvivingAndDeadTeams();

            if (_extantGenomes.Count() < ConcurrentShips)
            {
                records.Add(new ArenaRecord(_extantGenomes.Select(g => g.Value)));
                SaveRecords();

                MatchCountdown = _originalCountdown;

                string genome = PickRandomSurvivorGenome();
                genome = MutationControl.CreateSingleMutant(genome);

                SpawnShip(genome);
            }
            else
            {
                MatchCountdown -= Time.fixedDeltaTime;
            }

            if (MatchCountdown <= 0 && SuddenDeathObject != null)
            {
                ActivateSuddenDeath();
            }
        }

        private void ActivateSuddenDeath()
        {
            Debug.Log("Sudden Death!");
            var orientation = Random.rotation;
            var randomPlacement = ShipConfig.Config.PositionForCompetitor((int)Random.value, 0, 0, 0);
            var death = Instantiate(SuddenDeathObject, randomPlacement, orientation);

            death.GetComponent<IKnowsEnemyTags>().KnownEnemyTags = ShipConfig.Tags;
            MatchCountdown = SuddenDeathObjectReloadTime;
        }

        private string GetUnusedTag()
        {
            if (ShipConfig.Tags == null || !ShipConfig.Tags.Any())
            {
                return null;
            }
            return ShipConfig.Tags.FirstOrDefault(t => _extantGenomes == null || !_extantGenomes.Any(g => g.Key == t));
        }

        private string PickRandomSurvivorGenome()
        {
            if (_extantGenomes.Any())
            {
                var skip = (int)Random.value * _extantGenomes.Count();
                return _extantGenomes.Skip(skip).First().Value;
            }
            return DefaultGenome;
        }

        private void SaveRecords()
        {
            Debug.Log("Saving to " + Path.GetFullPath(FilePath));
            if (!File.Exists(FilePath))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
            }
            File.WriteAllLines(FilePath, records.Select(r => r.ToString()).ToArray());
        }

        private void SpawnInitialShips()
        {
            var genomes = GetGenomesFromHistory();
            Debug.Log("\"" + string.Join("\" vs \"", genomes.Select(g => g.TrimEnd()).ToArray()) + "\"");

            foreach (var g in genomes)
            {
                SpawnShip(g);
            }
        }

        private void SpawnShip(string genome)
        {
            Debug.Log("Spawning \"" + genome + "\"");
            var ownTag = GetUnusedTag();

            var index = ShipConfig.Tags.IndexOf(ownTag);

            ShipConfig.SpawnShip(genome, index, 0, 0, 0);

            RememberNewExtantGenome(ownTag, genome);
        }

        private void RememberNewExtantGenome(string tag, string genome)
        {
            if (_extantGenomes == null)
            {
                _extantGenomes = new Dictionary<string, string>();
            }

            _extantGenomes.Add(tag, genome);
        }

        private void DetectSurvivingAndDeadTeams()
        {
            var livingShips = GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                .Where(s =>
                    s.transform.parent != null &&
                    s.transform.parent.GetComponent<Rigidbody>() != null
                )
                .Select(s => s.transform.parent.tag)
                .Distinct();

            _extantGenomes = _extantGenomes.Where(g => livingShips.Contains(g.Key)).ToDictionary(g => g.Key, g => g.Value);
        }

        private IEnumerable<string> GetGenomesFromHistory()
        {
            var validRecords = records.Where(r => r.Survivors.Any()).ToList();
            var last = validRecords.LastOrDefault() ?? new ArenaRecord(DefaultGenome);
            return last.Survivors;
        }

        private void ReadPreviousMatches()
        {
            if (File.Exists(FilePath))
            {
                records = new List<ArenaRecord>();
                var lines = File.ReadAllLines(FilePath);
                foreach (var line in lines)
                {
                    records.Add(new ArenaRecord(line));
                }
                if (records.Any())
                {
                    return;
                }
            }

            //falback to seeding
            Debug.Log("File not found");
            records = new List<ArenaRecord>();
        }
    }

}