using Assets.Src.Evolution;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;
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
        Genome = Genome.PadRight(PadToLength);

        var genomeWrapper = new GenomeWrapper(Genome)
        {
            UseJump = false
        };

        if (OverrideColour)
        {
            genomeWrapper.ColorOverride = ColourOverride;
        }

        Configure(genomeWrapper);
        if(ColourOverride != null)
            transform.SetColor(ColourOverride);
    }
}
