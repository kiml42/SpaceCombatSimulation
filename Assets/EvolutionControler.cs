using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using System;

public class EvolutionControler : MonoBehaviour
{
    public Rigidbody ShipToEvolve;
    public Transform Location1;
    public Transform Location2;
    public string Tag1 = "Team1";
    public string Tag2 = "Team2";

    public string SpaceShipTag = "SpaceShip";
    private Dictionary<string, string> _currentGenomes;
    private List<MatchRecord> records = new List<MatchRecord>();

    public int GenerationSize = 10;

    // Use this for initialization
    void Start()
    {
        ReadPreviousMatches();
        SpawnShips();
    }

    // Update is called once per frame
    void Update()
    {
        var winningGenome = DetectVictorsGenome();
        if (!string.IsNullOrEmpty(winningGenome))
        {
            Debug.Log(winningGenome + " Wins!");
            records.Add(new MatchRecord(_currentGenomes.Values.ToArray(), winningGenome));
            Debug.Log(records.Count + " matches completed");
            SceneManager.LoadScene(SceneManager.GetActiveScene().name);
        }
    }

    private void SpawnShips()
    {
        var genomes = GenerateGenomes();
        var g1 = genomes[0];
        var ship1 = Instantiate(ShipToEvolve, Location1.position, Location1.rotation);
        ship1.tag = Tag1;
        ship1.SendMessage("SetEnemyTag", Tag2);
        ship1.SendMessage("SetGenome", g1);

        var g2 = genomes[1];
        var ship2 = Instantiate(ShipToEvolve, Location2.position, Location2.rotation);
        ship2.tag = Tag2;
        ship2.SendMessage("SetEnemyTag", Tag1);
        ship2.SendMessage("SetGenome", g2);

        _currentGenomes = new Dictionary<string, string>
        {
            {Tag1,g1 },
            {Tag2,g2 }
        };
    }

    private string DetectVictorsGenome()
    {
        var ships = GameObject.FindGameObjectsWithTag(SpaceShipTag);
        if (ships.Length == 1)
        {
            var ship = ships[0].transform.parent;
            var winningTag = ship.tag;

            return _currentGenomes[winningTag];
        }
        if(ships.Length == 0)
        {
            return string.Join(",", _currentGenomes.Values.ToArray());
        }
        return null;
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
        var g1 = records.Skip(skip).LastOrDefault();
        var g2 = records.Skip(++skip).LastOrDefault();
        return new string[] { g1.Victor, g2.Victor };
    }

    private void ReadPreviousMatches()
    {
        records = new List<MatchRecord>
        {
            new MatchRecord("02"),
            new MatchRecord("2"),
            new MatchRecord("3"),
            new MatchRecord("4"),
            new MatchRecord("5"),
            new MatchRecord("6"),
            new MatchRecord("7"),
            new MatchRecord("8")
        };
    }
}
