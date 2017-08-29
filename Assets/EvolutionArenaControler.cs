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
    public string FilePath = "./tmp/evolvingShips/evolvingShipsArena.csv";

    public string SpaceShipTag = "SpaceShip";
    private Dictionary<string, string> _currentGenomes;
    private List<ArenaRecord> records = new List<ArenaRecord>();

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
    private string DrawKeyword = "DRAW";

    public int MatchCountdown;
    private int _originalCountdown;
    public bool SetVelocity;
    private IEnumerable<KeyValuePair<string, string>> _extantGenomes;
    private IEnumerable<KeyValuePair<string, string>> _extinctGenomes;

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

            Debug.Log(records.Count + " matches completed");
            SaveRecords();
            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
            MatchCountdown = _originalCountdown;

            string genome = PickRandomSurvivor();
            genome = Mutate(genome);

            var tag = GetUnusedTag();

            SpawnShip(genome, tag);
        } else
        {
            MatchCountdown--;
        }
    }

    private string GetUnusedTag()
    {
        throw new NotImplementedException();
    }

    private string PickRandomSurvivor()
    {
        throw new NotImplementedException();
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

        var tags = Tags.ToList();
        var i = 0;

        _currentGenomes = new Dictionary<string, string>();

        foreach (var g in genomes)
        {
            var tag = tags[i];
            SpawnShip(g, tag);
            i++;
            _currentGenomes.Add(tag, g);
        }
    }

    private void SpawnShip(string genome, string ownTag)
    {
        var orientation = UnityEngine.Random.rotation;
        var randomPlacement = (SpawnSphereRadius * UnityEngine.Random.insideUnitSphere) + transform.position;
        var ship = Instantiate(ShipToEvolve, randomPlacement, orientation);
        ship.tag = ownTag;

        if (SetVelocity)
        {
            ship.velocity = GetComponent<Rigidbody>().velocity;
        }

        var enemyTags = Tags.Where(t => t != ownTag);

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
    }
    
    public static string Reverse(string s)
    {
        char[] charArray = s.ToCharArray();
        Array.Reverse(charArray);
        return new string(charArray);
    }

    private void DetectSurvivingAndDeadTeams()
    {
        var livingShips = GameObject.FindGameObjectsWithTag(SpaceShipTag)
            .Where(s =>
                s.transform.parent != null &&
                s.transform.parent.GetComponent("Rigidbody") != null
            )
            .Select(s => s.transform.parent.tag);

        _extantGenomes = _currentGenomes.Where(g => livingShips.Contains(g.Key));
        _extinctGenomes = _currentGenomes.Where(g => !livingShips.Contains(g.Key));
    }

    private string StringifyGenomes()
    {
        var s = "";
        foreach (var item in _currentGenomes)
        {
            s += item.Key + ":" + item.Value + ",";
        }
        return s;
    }

    private string[] GetDrawGenomes(bool timeout)
    {
        return new string[] { DrawKeyword + (timeout ? " - timeout" : " - EveryoneDied") };
    }

    //private string[] GenerateGenomes()
    //{
    //    var baseGenome = PickTwoGenomesFromHistory();
    //    return baseGenome.Select(g => Mutate(g)).ToArray();
    //}

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

    private IEnumerable<string> GetGenomesFromHistory()
    {
        var validRecords = records.Where(r => r.Survivors.Any()).ToList();
        var last = validRecords.LastOrDefault() ?? new ArenaRecord(";;;");
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
