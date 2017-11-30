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
    public class GenerationTargetShooting : IGeneration
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

        public int CountIndividuals()
        {
            return Individuals.Count;
        }

        public bool AddGenome(string genome)
        {
            if (Individuals.Any(i => i.Genome == genome))
            {
                return false;
            }
            Individuals.Add(new IndividualTargetShooting(genome));
            return true;
        }

        public void RecordMatch(string contestant, float finalScore, bool survived, bool killedEverything, int killsThisMatch)
        {
            //Debug.Log("Recording Match: " + a + " vs " + b + " victor: " + victor);

            Individuals.First(i => i.Genome == contestant).RecordMatch(finalScore, survived, killedEverything, killsThisMatch);

            SortGeneration();
        }

        public int MinimumMatchesPlayed()
        {
            return Individuals.Min(i => i.MatchesPlayed);
        }

        public IEnumerable<string> PickWinners(int WinnersCount)
        {
            return SortGeneration().Take(WinnersCount).Select(i => i.Genome);
        }

        private IEnumerable<IndividualTargetShooting> SortGeneration()
        {
            Individuals = Individuals.OrderByDescending(i => i.AverageScore).ThenByDescending(i => i.MatchesPlayed).ThenBy(i => _rng.NextDouble()).ToList();
            return Individuals;
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

        public override string ToString()
        {
            return string.Join(Environment.NewLine, Individuals.Select(i => i.ToString()).ToArray());
        }

        public int AddGenomes(List<string> Genomes)
        {
            foreach (var g in Genomes)
            {
                AddGenome(g);
            }
            return CountIndividuals();
        }

    }
}
