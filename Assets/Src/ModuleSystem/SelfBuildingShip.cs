using Assets.src.Evolution;
using Assets.Src.Evolution;
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

        var genomeWrapper = new GenomeWrapper(Genome)
        {
            MaxModules = MaxModules,
            MaxTurrets = MaxTurrets
        };

        new ShipBuilder(genomeWrapper, transform, ModuleList, TestCube)
        {
            OverrideColour = true,
            ColourOverride = ColourOverride,
            EnemyTags = targetChoosingMechanism.GetEnemyTags(),
            InitialVelocity = velocity
        }.BuildShip(false,false);
    }
}
