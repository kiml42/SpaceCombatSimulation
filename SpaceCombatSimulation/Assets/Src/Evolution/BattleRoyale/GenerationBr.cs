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
        /// Records a match by adding data to the individuals that participated.
        /// </summary>
        /// <param name="a">One of tehe combatant's genomes</param>
        /// <param name="b">Another of tehe combatant's genomes</param>
        /// <param name="victor">The genome of the winner - null for a draw</param>
        /// <param name="winScore">Score to add to the winner</param>
        /// <param name="lossScore">Score to add to the looser</param>
        /// <param name="drawScore">Score to add to both in the event of a draw</param>
        public void RecordMatch(GenomeWrapper a, GenomeWrapper b, string victor, float winScore, float lossScore, float drawScore)
        {
            //Debug.Log("Recording Match: " + a + " vs " + b + " victor: " + victor);

            var individuala = Individuals.First(i => i.Genome == a.Genome);
            individuala.Finalise(a);
            individuala.RecordMatch(b.Genome, victor,  winScore,  lossScore,  drawScore);

            var individualb = Individuals.First(i => i.Genome == b.Genome);
            individualb.Finalise(b);
            individualb.RecordMatch(a.Genome, victor,  winScore,  lossScore,  drawScore);

            Individuals = Individuals.OrderByDescending(i => i.AverageScore).ToList();
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
