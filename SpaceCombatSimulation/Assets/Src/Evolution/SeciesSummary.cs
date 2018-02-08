using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class SeciesSummary
    {
        public string Genome { get; private set; }
        public float? Cost { get; private set; }
        public float? Budget { get; private set; }

        public Dictionary<ModuleType, int> ModuleTypeCounts { get; private set; }
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
        public SeciesSummary(string genome)
        {
            Genome = genome;
        }

        /// <summary>
        /// Creates a species summary for a completed individual (after all the configuration has been run)
        /// </summary>
        /// <param name="genomeWrapper"></param>
        public SeciesSummary(GenomeWrapper genomeWrapper)
        {
            Genome = genomeWrapper.Genome;
            Cost = genomeWrapper.Cost;
            Budget = genomeWrapper.Budget;
            ModuleTypeCounts = genomeWrapper.ModuleTypeCounts;
            ModulesAdded = genomeWrapper.ModulesAdded;
            Color = genomeWrapper.GetColorForGenome();
            Species = genomeWrapper.Species;
            VerboseSpecies = genomeWrapper.VerboseSpecies;
            Subspecies = genomeWrapper.Subspecies;
            VerboseSubspecies = genomeWrapper.VerboseSubspecies;
        }

        public string GetName()
        {
            return Subspecies;
        }
    }
}
