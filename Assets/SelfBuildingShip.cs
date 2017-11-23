using Assets.src.Evolution;
using Assets.Src.Interfaces;
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
    
    public void Start()
    {
        var shipToEvolve = GetComponent<Rigidbody>();
        var targetChoosingMechanism = GetComponent<IKnowsEnemyTags>();

        var velocity = shipToEvolve.velocity;

        new ShipBuilder(Genome, transform, ModuleList, TestCube)
        {
            OverrideColour = true,
            ColourOverride = ColourOverride,
            EnemyTags = targetChoosingMechanism.GetEnemyTags(),
            MaxTurrets = MaxTurrets,
            MaxModules = MaxModules,
            InitialVelocity = velocity
        }.BuildShip(false,false);
    }
}
