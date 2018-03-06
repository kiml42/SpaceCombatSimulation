using Assets.src.Evolution;
using Assets.Src.Evolution;
using Assets.Src.ModuleSystem;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class EvolutionShipConfig : MonoBehaviour {
    public ModuleTypeKnower ShipToEvolve;

    public List<string> Tags = new List<string>{"Team1", "Team2" };

    public TestCubeChecker TestCube;
    [Tooltip("Randomise the rotation of all spawned ships")]
    public string SpaceShipTag = "SpaceShip";
    
    public ModuleList ModuleList;
    public int MaxTurrets = 10;
    public int MaxModules = 15;
    public float? Budget = 1000;

    public MatchConfig Config;

    /// <summary>
    /// Spawns a ship with the given genome.
    /// </summary>
    /// <param name="genome"></param>
    /// <param name="index"></param>
    /// <param name="stepsTowardsCentre"></param>
    /// <returns>Returns the GenomeWrapper for that ship.</returns>
    public GenomeWrapper SpawnShip(string genome, int index, float stepsTowardsCentre, float inSphereRandomisationRadius, float onSphereRandomisationRadius)
    {
        if(Config == null)
        {
            throw new Exception("EvolutionShipConfig needs to have its Config set to a valid MatchConfig");
        }
        
        var location = Config.PositionForCompetitor(index, stepsTowardsCentre, inSphereRandomisationRadius, onSphereRandomisationRadius);
        var orientation = Config.OrientationForStartLocation(location);
        var velocity = Config.VelocityForStartLocation(location);

        var ownTag = GetTag(index);

        var ship = Instantiate(ShipToEvolve, location, orientation);
        ship.tag = ownTag;

        var hub = ship.GetComponent<ModuleHub>();
        if (hub != null)
        {
            hub.AllowedModuleIndicies = Config.AllowedModuleIndicies;
        }

        var enemyTags = Tags.Where(t => t != ownTag).ToList();

        var genomeWrapper = new GenomeWrapper(genome, enemyTags)
        {
            Budget = Config.Budget
        };
        ship.GetComponent<Rigidbody>().velocity = velocity;

        genomeWrapper = ship.Configure(genomeWrapper);

        ship.name = genomeWrapper.Name;

        return genomeWrapper;
    }

    public string GetTag(int index)
    {
        if (!Tags.Any())
        {
            throw new Exception("The Tags list is empty");
        }
        var tagIndex = index % Tags.Count;

        return Tags[tagIndex];
    }
}
