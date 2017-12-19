using Assets.src.Evolution;
using Assets.Src.Evolution;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class EvolutionShipConfig : MonoBehaviour {
    public Rigidbody ShipToEvolve;

    public List<string> Tags = new List<string>{"Team1", "Team2" };

    public TestCubeChecker TestCube;
    [Tooltip("Randomise the rotation of all spawned ships")]
    public string SpaceShipTag = "SpaceShip";
    
    public ModuleList ModuleList;
    public int MaxTurrets = 10;
    public int MaxModules = 15;

    public MatchConfig Config;
    
    public void SpawnShip(string genome, int index, int stepsTowardsCentre = 0)
    {
        if(Config == null)
        {
            throw new Exception("EvolutionShipConfig needs to have its Config set to a valid MatchConfig");
        }
        
        var location = Config.PositionForCompetitor(index, stepsTowardsCentre);
        var orientation = Config.OrientationForStartLocation(location);
        var velocity = Config.VelocityForStartLocation(location);

        var ownTag = GetTag(index);

        var ship = Instantiate(ShipToEvolve, location, orientation);
        ship.tag = ownTag;
        var enemyTags = Tags.Where(t => t != ownTag).ToList();
        
        new ShipBuilder(genome, ship.transform, ModuleList, TestCube)
        {
            EnemyTags = enemyTags,
            MaxTurrets = MaxTurrets,
            MaxModules = MaxModules,
            InitialVelocity = velocity
        }.BuildShip();
        ship.velocity = velocity;

        ship.SendMessage("SetEnemyTags", enemyTags);
    }

    public string GetTag(int index)
    {
        if (!Tags.Any())
        {
            throw new System.Exception("The Tags list is empty");
        }
        var tagIndex = index % Tags.Count;

        return Tags[tagIndex];
    }
}
