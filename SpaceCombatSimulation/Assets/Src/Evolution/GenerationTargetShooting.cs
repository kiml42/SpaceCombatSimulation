using Assets.Src.Evolution;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    /// <summary>
    /// Class for storing a generation where each ship fights one other.
    /// </summary>
    public class GenerationTargetShooting : BasseGeneration
    {
        private System.Random _rng = new System.Random();
        public List<IndividualTargetShooting> Individuals = new List<IndividualTargetShooting>();

        public GenerationTargetShooting()
        {
            //Debug.Log("Default Constructor");
        }

        public GenerationTargetShooting(string[] lines)
        {
            AddGenomes(lines.ToList());
        }

        public GenerationTargetShooting(List<string> lines)
        {
            AddGenomes(lines);
        }

        public override bool AddGenome(string genome)
        {
            if (Individuals.Any(i => i.Genome == genome))
            {
                return false;
            }
            Individuals.Add(new IndividualTargetShooting(genome));
            return true;
        }

        public void RecordMatch(GenomeWrapper contestant, float finalScore, bool survived, bool killedEverything, int killsThisMatch)
        {
            var individual = Individuals.First(i => i.Genome == contestant.Genome);
            individual.Finalise(contestant);
            individual.RecordMatch(finalScore, survived, killedEverything, killsThisMatch);
        }

        protected override IEnumerable<BaseIndividual> _baseIndividuals
        {
            get
            {
                return Individuals.Select(i => i as BaseIndividual);
            }
        }

        /// <summary>
        /// Returns a genome from the individual in this generation with the lowest number of completed matches.
        /// </summary>
        /// <returns>genome of a competetor from this generation</returns>
        public string PickCompetitor()
        {
            List<IndividualTargetShooting> validCompetitors;
            
            validCompetitors = Individuals
                .OrderBy(i => i.MatchesPlayed)
                .ThenBy(i => _rng.NextDouble())
                .ToList();

            var best = validCompetitors.FirstOrDefault();
            //Debug.Log("Picked Individual has played " + best.MatchesPlayed);
            if (best != null)
            {
                return best.Genome;
            }
            return null;
        }
    }
}
