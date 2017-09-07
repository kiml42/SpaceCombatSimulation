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
    public bool RandomiseRotation = true;
    public float LocationRandomisationRadius = 0;
    public string Tag1 = "Team1";
    public string Tag2 = "Team2";
    public string FilePath = "./tmp/evolvingShips/evolvingShips.csv";

    public string SpaceShipTag = "SpaceShip";
    private Dictionary<string, string> _currentGenomes;
    private List<MatchRecord> records = new List<MatchRecord>();

    public int GenerationSize = 10;
    public int MatchTimeout = 10000;

    public int Mutations = 3;
    
    public int MaxTurrets = 10;
    public string AllowedCharacters = " 0123456789  ";
    
    public int MaxMutationLength = 5;
    
    public int MaxShootAngle = 180;
    public int MaxTorqueMultiplier = 2000;
    public int MaxLocationAimWeighting = 10;
    public int MaxSlowdownWeighting = 60;
    public int MaxLocationTollerance = 1000;
    public int MaxVelociyTollerance = 200;
    public int MaxAngularDragForTorquers = 1;

    public int GenomeLength = 50;
    
    public List<Rigidbody> Modules;
    private string DrawKeyword = "DRAW";
    private StringMutator _mutator;
    public string DefaultGenome = "";

    // Use this for initialization
    void Start()
    {
        _mutator = new StringMutator();
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
            winningGenomes = GetDrawGenomes(true);
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
        var randomPlacement = (LocationRandomisationRadius * UnityEngine.Random.insideUnitSphere) + location.position;
        var ship = Instantiate(ShipToEvolve, randomPlacement, orientation);
        ship.tag = ownTag;
        var enemyTags = new List<string> { enemyTag };

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
            return GetDrawGenomes(false);
        }
        return null;
    }

    private string[] GetDrawGenomes(bool timeout)
    {
        return new string[] { DrawKeyword + (timeout ? " - timeout" : " - EveryoneDied") };
    }

    private string[] GenerateGenomes()
    {
        var baseGenome = PickTwoGenomesFromHistory();
        return baseGenome.Select(g => _mutator.Mutate(g)).ToArray();
    }
    
    private string[] PickTwoGenomesFromHistory()
    {
        var validRecords = records.Where(r => !string.IsNullOrEmpty(r.Victor) && !r.Victor.Contains(DrawKeyword)).ToList();
        var skip = Math.Max(validRecords.Count - GenerationSize, 0);
        var g1 = validRecords.Skip(skip).FirstOrDefault() ?? new MatchRecord(DefaultGenome);
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
        records = new List<MatchRecord>();
    }
}
