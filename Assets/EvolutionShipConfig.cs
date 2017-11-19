using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class EvolutionShipConfig : MonoBehaviour {
    public Rigidbody ShipToEvolve;

    public List<string> Tags = new List<string>{"Team1", "Team2" };

    public List<Transform> Locations;

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
    
    public void SpawnShip(string genome, int index)
    {
        if(!Tags.Any() || !Locations.Any() || !LocationRandomisationRadiai.Any())
        {
            throw new System.Exception("One or more of the ship config lists is empty - they must all have at least one element.");
        }
        var tagIndex = Mathf.Min(Tags.Count - 1, index);
        var locIndex = Mathf.Min(Locations.Count - 1, index);
        var LocRandIndex = Mathf.Min(LocationRandomisationRadiai.Count - 1, index);

        SpawnShip(genome, Tags[tagIndex], Locations[locIndex], LocationRandomisationRadiai[LocRandIndex]);
    }
    
    private void SpawnShip(string genome, string ownTag, Transform location, float locationRandomisationRadius)
    {
        var orientation = RandomiseRotation ? UnityEngine.Random.rotation : location.rotation;
        var randomPlacement = (locationRandomisationRadius * UnityEngine.Random.insideUnitSphere) + location.position;
        var ship = Instantiate(ShipToEvolve, randomPlacement, orientation);
        ship.tag = ownTag;
        var enemyTags = Tags.Where(t => t != ownTag).ToList();

        var velocity = location.forward * InitialSpeed + UnityEngine.Random.insideUnitSphere * RandomInitialSpeed;

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
