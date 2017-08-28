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
    private List<MatchRecord> records = new List<MatchRecord>();

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

    // Use this for initialization
    void Start()
    {
        _originalCountdown = MatchCountdown;
        ReadPreviousMatches();
        SpawnShips();
    }

    // Update is called once per frame
    void Update()
    {
        var deadGenomes = DetectDeadTeams();
        if (deadGenomes == null)
        {
            MatchCountdown--;
            return;
        }

        foreach (var genome in deadGenomes)
        {
            Debug.Log(genome + " Wins!");
            records.Add(new MatchRecord(_currentGenomes.Values.ToArray(), genome));
        }

        Debug.Log(records.Count + " matches completed");
        SaveRecords();
        SceneManager.LoadScene(SceneManager.GetActiveScene().name);
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

    private void SpawnShips()
    {
        var genomes = GenerateGenomes();

        Debug.Log("\"" + string.Join("\" vs \"", genomes.Select(g => g.TrimEnd()).ToArray()) + "\"");

        var g1 = genomes[0];
        var g2 = genomes[1];

        SpawnShip(g1, Tag1, Tag2, Location1);
        SpawnShip(g2, Tag2, Tag1, Location2);

        _currentGenomes = new Dictionary<string, string>
        {
            {Tag1,g1 },
            {Tag2,g2 }
        };
    }

    private void SpawnShip(string genome, string ownTag, string enemyTag, Transform location)
    {
        var orientation = RandomiseRotation ? UnityEngine.Random.rotation : location.rotation;
        var randomPlacement = (SpawnSphereRadius * UnityEngine.Random.insideUnitSphere) + location.position;
        var ship = Instantiate(ShipToEvolve, randomPlacement, orientation);
        ship.tag = ownTag;

        new ShipBuilder(genome, ship.transform, Modules)
        {
            MaxShootAngle = MaxShootAngle,
            MaxTorqueMultiplier = MaxTorqueMultiplier,
            MaxLocationAimWeighting = MaxLocationAimWeighting,
            MaxSlowdownWeighting = MaxSlowdownWeighting,
            MaxLocationTollerance = MaxLocationTollerance,
            MaxVelociyTollerance = MaxVelociyTollerance,
            MaxAngularDragForTorquers = MaxAngularDragForTorquers,
            EnemyTag = enemyTag,
            MaxTurrets = MaxTurrets
        }.BuildShip();

        ship.SendMessage("SetEnemyTag", enemyTag);
    }
    
    public static string Reverse(string s)
    {
        char[] charArray = s.ToCharArray();
        Array.Reverse(charArray);
        return new string(charArray);
    }

    private IEnumerable<KeyValuePair<string,string>> DetectDeadTeams()
    {
        var ships = GameObject.FindGameObjectsWithTag(SpaceShipTag)
            .Where(s =>
            s.transform.parent != null &&
            s.transform.parent.GetComponent("Rigidbody") != null
            );
        //Debug.Log(ships.Count() + " ships exist");

        if (ships.Count() < ConcurrentShips)
        {
            var livingShips = ships.Select(s => s.transform.parent.tag);

            return _currentGenomes.Where(g => !livingShips.Contains(g.Key));
        }
        if (ships.Count() == 0)
        {
            Debug.Log("Everyone's dead!");
            return _currentGenomes;
        }
        return new List<KeyValuePair<string,string>>();
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

    private string[] GenerateGenomes()
    {
        var baseGenome = PickTwoGenomesFromHistory();
        return baseGenome.Select(g => Mutate(g)).ToArray();
    }

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

    private string[] PickTwoGenomesFromHistory()
    {
        var validRecords = records.Where(r => !string.IsNullOrEmpty(r.Victor) && !r.Victor.Contains(DrawKeyword)).ToList();
        var skip = Math.Max(validRecords.Count - ConcurrentShips, 0);
        var g1 = validRecords.Skip(skip).FirstOrDefault();
        var g2 = validRecords.Skip(++skip).FirstOrDefault() ?? g1;
        return new string[] { g1.Victor, g2.Victor };
    }

    private void ReadPreviousMatches()
    {
        if (File.Exists(FilePath))
        {
            records = new List<MatchRecord>();
            var lines = File.ReadAllLines(FilePath);
            foreach (var line in lines)
            {
                records.Add(new MatchRecord(line));
            }
            if (records.Any())
            {
                return;
            }
        }

        //falback to seeding
        Debug.Log("File not found");
        records = new List<MatchRecord>
        {
            new MatchRecord("22222"),
            new MatchRecord("33333"),
            new MatchRecord("44444"),
            new MatchRecord("55555"),
            new MatchRecord("66666"),
            new MatchRecord("77777"),
            new MatchRecord("88888"),
            new MatchRecord("99999")
        };
    }
}
