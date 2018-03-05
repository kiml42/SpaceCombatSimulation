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
    public class GenerationBr : BasseGeneration
    {
        private System.Random _rng = new System.Random();
        public List<IndividualBr> Individuals = new List<IndividualBr>();

        public GenerationBr()
        {
            //Debug.Log("Default Constructor");
        }

        public GenerationBr(string[] lines)
        {
            AddGenomes(lines.ToList());
        }

        public GenerationBr(List<string> lines)
        {
            AddGenomes(lines);
        }

        public override bool AddGenome(string genome)
        {
            if (Individuals.Any(i => i.Genome == genome))
            {
                return false;
            }
            Individuals.Add(new IndividualBr(genome));
            return true;
        }

        /// <summary>
        /// Records a match for one individual by adding data to that individual.
        /// </summary>
        /// <param name="competitor">the combatant's genomes</param>
        /// <param name="score">Score to add to the combatant</param>
        /// <param name="allCompetitors">All the individuals' genomes in the match</param>
        /// <param name="hasWon">True if this individual was the last surviving individual</param>
        /// <param name="isDraw">True if this individual was not the only one alive at the end of time</param>
        /// <param name="hasDied">True if this individual died</param>
        public void RecordMatch(GenomeWrapper competitor, float score, List<string> allCompetitors, MatchOutcome outcome)
        {
            var individual = Individuals.First(i => i.Genome == competitor.Genome);
            individual.Finalise(competitor);
            individual.RecordMatch(score, allCompetitors, outcome);
        }

        protected override IEnumerable<BaseIndividual> _baseIndividuals
        {
            get
            {
                return Individuals.Select(i => i as BaseIndividual);
            }
        }

        /// <summary>
        /// Returns a genome from the individuals in this generation with the lowest number of completed matches.
        /// If any competitorsAlreadyInMatch are provided this returns the individual with the fewest matches against any of those individuals.
        /// </summary>
        /// <param name="genomeToCompeteWith"></param>
        /// <returns>genome of a competetor from this generation</returns>
        private string PickCompetitor(List<string> competitorsAlreadyInMatch)
        {
            List<IndividualBr> validCompetitors;
            
            validCompetitors = Individuals
                .Where(i => !competitorsAlreadyInMatch.Contains(i.Genome))
                .OrderBy(i => i.CountPreviousMatchesAgainst(competitorsAlreadyInMatch))
                .ThenBy(i => i.MatchesPlayed)
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

        public List<string> PickCompetitors(int count)
        {
            var genomes = new List<string>();

            for(var i = 0; i < count; i++)
            {
                genomes.Add(PickCompetitor(genomes));
            }

            return genomes;
        }
    }
}
