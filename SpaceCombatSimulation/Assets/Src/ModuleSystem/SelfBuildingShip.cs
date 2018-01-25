using Assets.src.Evolution;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SelfBuildingShip : ModuleHub
{
    public string Genome;
    public int MaxTurrets = 10;
    public int MaxModules = 15;
    public int PadToLength = 100;

    public bool OverrideColour = true;
    public Color ColourOverride;

    public void Start()
    {
        var knower = GetComponent<IKnowsEnemyTags>();

        Genome = Genome.PadRight(PadToLength);

        var genomeWrapper = new GenomeWrapper(Genome, knower.EnemyTags)
        {
            UseJump = false
        };

        if (OverrideColour)
        {
            genomeWrapper.ColorOverride = ColourOverride;
        }

        Configure(genomeWrapper);
    }
}
