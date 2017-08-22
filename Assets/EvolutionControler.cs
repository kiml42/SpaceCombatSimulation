using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;
using System.IO;
using Assets.Src.ObjectManagement;

public class EvolutionControler : MonoBehaviour
{
    public Rigidbody ShipToEvolve;
    public Transform Location1;
    public Transform Location2;
    public string Tag1 = "Team1";
    public string Tag2 = "Team2";
    public string FilePath = "./tmp/evolvingShips/evolvingShips.csv";

    public string SpaceShipTag = "SpaceShip";
    private Dictionary<string, string> _currentGenomes;
    private List<MatchRecord> records = new List<MatchRecord>();

    public int GenerationSize = 10;
    public int MatchTimeout = 10000;

    public int MinMutations = 1;
    public float MutationsperGene = 0.1f;

    //TODO include 1 when engines work
    public string AllowedCharacters = " 023456789  ";

    public int MaxMutationLength = 5;
    public int MaxDesiredDistance = 1000;

    public int MaxGenomeLength = 200;

    // Use this for initialization
    void Start()
    {
        ReadPreviousMatches();
        SpawnShips();
    }

    // Update is called once per frame
    void Update()
    {
        var winningGenomes = DetectVictorsGenome();
        if (winningGenomes == null && MatchTimeout > 0)
        {
            MatchTimeout--;
            return;
        }
        else if (MatchTimeout <= 0)
        {
            Debug.Log("Timeout - draw");
            winningGenomes = GetDrawGenomes();
        }

        foreach (var genome in winningGenomes)
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

        Debug.Log(string.Join(" vs ", genomes));

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
        var ship = Instantiate(ShipToEvolve, location.position, location.rotation);
        ship.tag = ownTag;
        ship.SendMessage("SetEnemyTag", enemyTag);
        ship.SendMessage("SetGenome", genome);
        ConfigureShip(ship, genome);
    }

    private void ConfigureShip(Rigidbody ship, string genome)
    {
        var controller = ship.GetComponent<SpaceShipControler> ();
        controller.LocationTollerance = GetNumberFromGenome(genome, 0) * MaxDesiredDistance;
    }

    private float GetNumberFromGenome(string genome, int fromEnd)
    {
        var simplified = genome.Replace(" ", "");
        if (simplified.Length > fromEnd)
        {
            simplified = Reverse(simplified) + "  ";
            var stringNumber = simplified.Substring(fromEnd, 2);
            int number;
            if (int.TryParse(stringNumber, out number))
            {
                return number/99f;
            }
        }
        return 1;
    }
    
    public static string Reverse(string s)
    {
        char[] charArray = s.ToCharArray();
        Array.Reverse(charArray);
        return new string(charArray);
    }

    private string[] DetectVictorsGenome()
    {
        var ships = GameObject.FindGameObjectsWithTag(SpaceShipTag)
            .Where(s =>
            s.transform.parent != null &&
            s.transform.parent.GetComponent("Rigidbody") != null
            );
        //Debug.Log(ships.Count() + " ships exist");

        if (ships.Count() == 1)
        {
            var ship = ships.First().transform.parent;
            var winningTag = ship.tag;

            //Debug.Log(StringifyGenomes() + " winning tag: " + winningTag);
            return new string[] { _currentGenomes[winningTag] };
        }
        if (ships.Count() == 0)
        {
            Debug.Log("Everyone's dead!");
            return GetDrawGenomes();
        }
        return null;
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

    private string[] GetDrawGenomes()
    {
        return new string[] { _currentGenomes.Values.FirstOrDefault() };
    }

    private string[] GenerateGenomes()
    {
        var baseGenome = PickTwoGenomesFromHistory();
        return baseGenome.Select(g => Mutate(g)).ToArray();
    }

    private string Mutate(string baseGenome)
    {
        var mutations = MinMutations + (baseGenome.Length * MutationsperGene);
        for (int i = 0; i < mutations; i++)
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
                baseGenome = DuplicationMutation(baseGenome);
            }
        }

        if(baseGenome.Length > MaxGenomeLength)
        {
            return baseGenome.Substring(0, MaxGenomeLength);
        }
        return baseGenome;
    }

    private string InsertionMutation(string genome)
    {
        int n = (int)(UnityEngine.Random.value * AllowedCharacters.Length);
        var character = AllowedCharacters[n];
        int m = (int)(UnityEngine.Random.value * genome.Length);
        return genome.Insert(m, character.ToString());
    }

    private string DeletionMutation(string genome)
    {
        int n = (int)(UnityEngine.Random.value * genome.Length);
        int count = PickALength(n, genome.Length);
        //Debug.Log("n:" + n + ", count:" + count + ", length:" + genome.Length);
        return genome.Remove(n, count);
    }

    private string DuplicationMutation(string genome)
    {
        int n = (int)(UnityEngine.Random.value * genome.Length);
        int count = PickALength(n, genome.Length);
        var duplicated = genome.Substring(n, count);

        return genome.Insert(n, duplicated);
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
        var skip = Math.Max(records.Count - GenerationSize, 0);
        var g1 = records.Skip(skip).FirstOrDefault();
        var g2 = records.Skip(++skip).FirstOrDefault();
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
