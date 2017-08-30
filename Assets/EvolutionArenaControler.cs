using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;
using System.IO;
using Assets.Src.ObjectManagement;

public class EvolutionArenaControler : MonoBehaviour
{
    public Rigidbody ShipToEvolve;
    public float SpawnSphereRadius = 1000;
    public List<string> Tags;
    public string FilePath = "./tmp/evolvingShipsArena/evolvingShipsArena.csv";

    public string SpaceShipTag = "SpaceShip";

    public int ConcurrentShips = 5;

    public int Mutations = 3;
    
    public int MaxTurrets = 10;
    public int MaxModules = 15;
    public string AllowedCharacters = " 0123456789  ";
    
    public int MaxMutationLength = 5;
    
    public int MaxShootAngle = 180;
    public int MaxTorqueMultiplier = 60000;
    public int MaxLocationAimWeighting = 10;
    public int MaxSlowdownWeighting = 60;
    public int MaxLocationTollerance = 2000;
    public int MaxVelociyTollerance = 100;
    public int MaxAngularDragForTorquers = 5;

    public int GenomeLength = 50;
    
    public List<Rigidbody> Modules;

    public int MatchCountdown;
    public bool SetVelocity;
    public string DefaultGenome = "";


    private List<ArenaRecord> records = new List<ArenaRecord>();

    private int _originalCountdown;
    private Dictionary<string, string> _extantGenomes;
    private StringMutator _mutator;

    // Use this for initialization
    void Start()
    {
        _mutator = new StringMutator();
        _originalCountdown = MatchCountdown;
        ReadPreviousMatches();
        SpawnInitialShips();
    }

    // Update is called once per frame
    void Update()
    {
        DetectSurvivingAndDeadTeams();

        if(_extantGenomes.Count() < ConcurrentShips)
        {
            records.Add(new ArenaRecord(_extantGenomes.Select(g => g.Value)));
            SaveRecords();

            MatchCountdown = _originalCountdown;

            string genome = PickRandomSurvivorGenome();
            genome = _mutator.Mutate(genome);

            SpawnShip(genome);
        } else
        {
            MatchCountdown--;
        }
    }

    private string GetUnusedTag()
    {
        if(Tags == null || !Tags.Any())
        {
            return null;
        }
        return Tags.FirstOrDefault(t => _extantGenomes == null || !_extantGenomes.Any(g => g.Key == t));
    }

    private string PickRandomSurvivorGenome()
    {
        if (_extantGenomes.Any())
        {
            var skip = (int)UnityEngine.Random.value * _extantGenomes.Count();
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
        var orientation = UnityEngine.Random.rotation;
        var randomPlacement = (SpawnSphereRadius * UnityEngine.Random.insideUnitSphere) + transform.position;
        var ship = Instantiate(ShipToEvolve, randomPlacement, orientation);
        ship.tag = ownTag;

        if (SetVelocity)
        {
            ship.velocity = GetComponent<Rigidbody>().velocity;
        }

        var enemyTags = Tags.Where(t => t != ownTag).ToList();

        new ShipBuilder(genome, ship.transform, Modules)
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
            MaxModules = MaxModules
        }.BuildShip();

        ship.SendMessage("SetEnemyTags", enemyTags);

        RememberNewExtantGenome(ownTag, genome);
    }

    private void RememberNewExtantGenome(string tag, string genome)
    {
        if(_extantGenomes == null)
        {
            _extantGenomes = new Dictionary<string, string>();
        }

        _extantGenomes.Add(tag, genome);
    }

    private void DetectSurvivingAndDeadTeams()
    {
        var livingShips = GameObject.FindGameObjectsWithTag(SpaceShipTag)
            .Where(s =>
                s.transform.parent != null &&
                s.transform.parent.GetComponent("Rigidbody") != null
            )
            .Select(s => s.transform.parent.tag);

        _extantGenomes = _extantGenomes.Where(g => livingShips.Contains(g.Key)).ToDictionary(g => g.Key, g => g.Value);
    }

    private IEnumerable<string> GetGenomesFromHistory()
    {
        var validRecords = records.Where(r => r.Survivors.Any()).ToList();
        var last = validRecords.LastOrDefault() ?? new ArenaRecord(DefaultGenome);
        Debug.Log(last);
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
