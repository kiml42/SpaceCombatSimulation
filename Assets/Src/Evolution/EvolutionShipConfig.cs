using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class EvolutionShipConfig : MonoBehaviour {
    public Rigidbody ShipToEvolve;

    public List<string> Tags = new List<string>{"Team1", "Team2" };

    public List<float> LocationRandomisationRadiai = new List<float> { 0, 0 };

    public TestCubeChecker TestCube;
    [Tooltip("Randomise the rotation of all spawned ships")]
    public bool RandomiseRotation = true;
    public float InitialSpeed = 0;
    public float RandomInitialSpeed = 0;
    public string SpaceShipTag = "SpaceShip";


    public ModuleList ModuleList;
    public int MaxTurrets = 10;
    public int MaxModules = 15;
    
    public void SpawnShip(string genome, int index, Vector3 location)
    {
        if(!Tags.Any() || !LocationRandomisationRadiai.Any())
        {
            throw new System.Exception("One or more of the ship config lists is empty - they must all have at least one element.");
        }
        var tagIndex = Mathf.Min(Tags.Count - 1, index);
        var LocRandIndex = Mathf.Min(LocationRandomisationRadiai.Count - 1, index);

        SpawnShip(genome, Tags[tagIndex], location, LocationRandomisationRadiai[LocRandIndex]);
    }

    public string GetTag(int index)
    {
        if (!Tags.Any())
        {
            throw new System.Exception("The Tags list is empty");
        }
        var tagIndex = Mathf.Min(Tags.Count - 1, index);

        return Tags[tagIndex];
    }

    public float GetLocationRandomisationRadius(int index)
    {
        if (!LocationRandomisationRadiai.Any())
        {
            throw new System.Exception("The LocationRandomisationRadiai list is empty.");
        }
        var LocRandIndex = Mathf.Min(LocationRandomisationRadiai.Count - 1, index);

        return LocationRandomisationRadiai[LocRandIndex];
    }

    private void SpawnShip(string genome, string ownTag, Vector3 location, float locationRandomisationRadius)
    {
        var vectorTowardsCentre = -location.normalized;
        
        var orientation = RandomiseRotation ? Random.rotation : Quaternion.LookRotation(vectorTowardsCentre);

        var randomPlacement = (locationRandomisationRadius * Random.insideUnitSphere) + location;

        var ship = Instantiate(ShipToEvolve, randomPlacement, orientation);
        ship.tag = ownTag;
        var enemyTags = Tags.Where(t => t != ownTag).ToList();

        //velocity always points towards the centre
        var velocity = vectorTowardsCentre * InitialSpeed + Random.insideUnitSphere * RandomInitialSpeed;

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
}
