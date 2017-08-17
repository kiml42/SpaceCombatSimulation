using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;
using System.IO;

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
        } else if (MatchTimeout <= 0)
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
        var ship1 = Instantiate(ShipToEvolve, location.position, location.rotation);
        ship1.tag = ownTag;
        ship1.SendMessage("SetEnemyTag", enemyTag);
        ship1.SendMessage("SetGenome", genome);
    }

    private string[] DetectVictorsGenome()
    {
        var ships = GameObject.FindGameObjectsWithTag(SpaceShipTag);
        if (ships.Length == 1)
        {
            var ship = ships[0].transform.parent;
            var winningTag = ship.tag;

            return new string[] { _currentGenomes[winningTag] };
        }
        if(ships.Length == 0)
        {
            return GetDrawGenomes();
        }
        return null;
    }

    private string[] GetDrawGenomes()
    {
        return _currentGenomes.Values.ToArray();
    }

    private string[] GenerateGenomes()
    {
        var baseGenome = PickTwoGenomesFromHistory();
        return baseGenome.Select(g => Mutate(g)).ToArray();
    }

    private string Mutate(string baseGenome)
    {
        return baseGenome;
    }

    private string[] PickTwoGenomesFromHistory()
    {
        var skip = Math.Max(records.Count - GenerationSize,0);
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
