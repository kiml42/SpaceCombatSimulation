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
    public class Generation1v1 : BasseGeneration
    {
        private System.Random _rng = new System.Random();
        public List<Individual1v1> Individuals = new List<Individual1v1>();

        public Generation1v1()
        {
            //Debug.Log("Default Constructor");
        }

        public Generation1v1(string[] lines)
        {
            AddGenomes(lines.ToList());
        }

        public Generation1v1(List<string> lines)
        {
            AddGenomes(lines);
        }

        public override bool AddGenome(string genome)
        {
            if (Individuals.Any(i => i.Genome == genome))
            {
                return false;
            }
            Individuals.Add(new Individual1v1(genome));
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
        /// If a non-empty genome is provded, the genome provided will not be that one, or be one that has already competed with that one.
        /// </summary>
        /// <param name="genomeToCompeteWith"></param>
        /// <returns>genome of a competetor from this generation</returns>
        public string PickCompetitor(string genomeToCompeteWith = null)
        {
            List<Individual1v1> validCompetitors;

            if (!string.IsNullOrEmpty(genomeToCompeteWith))
            {
                validCompetitors = Individuals
                    .Where(i => i.Genome != genomeToCompeteWith && !i.PreviousCombatants.Contains(genomeToCompeteWith))
                    .OrderBy(i => i.MatchesPlayed)
                    .ThenBy(i => _rng.NextDouble())
                    .ToList();
            } else
            {
                validCompetitors = Individuals
                    .OrderBy(i => i.MatchesPlayed)
                    .ThenBy(i => _rng.NextDouble())
                    .ToList();
            }

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
