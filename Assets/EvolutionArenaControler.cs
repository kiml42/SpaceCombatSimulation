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
    
    public int MaxTurrets = 15;
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
    private string DrawKeyword = "DRAW";

    private int _originalCountdown;
    private Dictionary<string, string> _extantGenomes;

    // Use this for initialization
    void Start()
    {
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
            genome = Mutate(genome);

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
            MaxTurrets = MaxTurrets
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

    #region Mutation
    private string Mutate(string baseGenome)
    {
        baseGenome = baseGenome.PadRight(GenomeLength, ' ');
        for (int i = 0; i < Mutations; i++)
        {
            var n = UnityEngine.Random.value;
            if (n < 0.5)
            {
                //no mutation
            }
            else if (n < 0.8)
            {
                //insert
                baseGenome = InsertionMutation(baseGenome);
            }
            else if (n < 0.93)
            {
                //delete
                baseGenome = DeletionMutation(baseGenome);
            }
            else
            {
                //duplicate
                baseGenome = ReverseMutation(baseGenome);
            }
        }

        if(baseGenome.Length > GenomeLength)
        {
            return baseGenome.Substring(0, GenomeLength);
        }
        return baseGenome;
    }

    private string InsertionMutation(string genome)
    {
        int n = (int)(UnityEngine.Random.value * AllowedCharacters.Length);
        var character = AllowedCharacters[n];
        int m = (int)(UnityEngine.Random.value * genome.Length);
        genome.Remove(m, 1);
        return genome.Insert(m, character.ToString());
    }

    private string DeletionMutation(string genome)
    {
        int n = (int)(UnityEngine.Random.value * genome.Length);
        int count = PickALength(n, genome.Length);
        //Debug.Log("n:" + n + ", count:" + count + ", length:" + genome.Length);
        genome = genome.Remove(n, count);
        genome = genome.PadRight(GenomeLength, ' ');
        return genome;
    }

    private string ReverseMutation(string genome)
    {
        int n = (int)(UnityEngine.Random.value * genome.Length);
        int count = PickALength(n, genome.Length);
        var sectionToReverse = Reverse(genome.Substring(n, count));
        genome.Remove(n, count);
        return genome.Insert(n, sectionToReverse);
    }

    public static string Reverse(string s)
    {
        char[] charArray = s.ToCharArray();
        Array.Reverse(charArray);
        return new string(charArray);
    }

    private int PickALength(int start, int fullLength)
    {
        var remaining = fullLength - start;
        if(remaining == 0)
        {
            return remaining;
        }
        var limit = Math.Min(remaining, MaxMutationLength);
        var result = (int) UnityEngine.Random.value * limit;
        return Math.Max(result, 1);
    }
    #endregion

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
