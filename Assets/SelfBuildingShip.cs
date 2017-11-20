using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SelfBuildingShip : MonoBehaviour {
    public string Genome;
    public TestCubeChecker TestCube;
    public ModuleList ModuleList;
    public int MaxTurrets = 10;
    public int MaxModules = 15;
    public List<string> EnemyTags;
    public Color ColourOverride;

    private Rigidbody _shipToEvolve;
    
    public void Start()
    {
        _shipToEvolve = GetComponent<Rigidbody>();
        var shipController = GetComponent<SpaceShipControler>();
        var velocity = _shipToEvolve.velocity;

        new ShipBuilder(Genome, transform, ModuleList, TestCube)
        {
            OverrideColour = true,
            ColourOverride = ColourOverride,
            EnemyTags = shipController.EnemyTags,
            MaxTurrets = MaxTurrets,
            MaxModules = MaxModules,
            InitialVelocity = velocity
        }.BuildShip(false,false);
    }
}
