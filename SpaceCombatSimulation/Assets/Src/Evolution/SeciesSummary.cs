using UnityEngine;

namespace Assets.Src.Evolution
{
    public class SpeciesSummary
    {
        public string Genome { get; private set; }
        public float? Cost { get; private set; }
        
        public int? ModulesAdded { get; private set; }

        public Color Color { get; private set; }

        public string Species { get; private set; }

        public string VerboseSpecies { get; private set; }

        public string Subspecies { get; private set; }

        public string VerboseSubspecies { get; private set; }

        /// <summary>
        /// creates a summary for an incomplete individual (before the configuration has been run)
        /// </summary>
        /// <param name="genome"></param>
        public SpeciesSummary(string genome)
        {
            Genome = genome;
        }

        /// <summary>
        /// Creates a species summary for a completed individual (after all the configuration has been run)
        /// </summary>
        /// <param name="genomeWrapper"></param>
        public SpeciesSummary(GenomeWrapper genomeWrapper)
        {
            Genome = genomeWrapper.Genome;
            Cost = genomeWrapper.Cost;
            ModulesAdded = genomeWrapper.ModulesAdded;
            Color = genomeWrapper.GetColorForGenome();
            Species = genomeWrapper.Species;
            VerboseSpecies = genomeWrapper.VerboseSpecies;
            Subspecies = genomeWrapper.Subspecies;
            VerboseSubspecies = genomeWrapper.VerboseSubspecies;
        }

        /// <summary>
        /// Creates a species summary for a completed individual with specified values
        /// </summary>
        /// <param name="genomeWrapper"></param>
        public SpeciesSummary(string genome, float? cost, int? modulesAdded, float r, float g, float b, string species, string verboseSpecies, string subspecies, string verboseSubspecies)
        {
            Genome = genome;
            Cost = cost;
            ModulesAdded = modulesAdded;
            Color = new Color(r,g,b);
            Species = species;
            VerboseSpecies = verboseSpecies;
            Subspecies = subspecies;
            VerboseSubspecies = verboseSubspecies;
        }

        public string GetName()
        {
            return Subspecies;
        }
    }
}
