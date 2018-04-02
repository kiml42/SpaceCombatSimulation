using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public abstract class BaseGeneration
    {
        private Random _rng = new Random();

        protected abstract IEnumerable<BaseIndividual> _baseIndividuals { get; }

        public int CountIndividuals()
        {
            return _baseIndividuals.Count();
        }

        /// <summary>
        /// Adds a new individual with the given genome.
        /// Does nothing in the case of a duplicate
        /// </summary>
        /// <param name="genome"></param>
        /// <returns>Successfully added - false id genome already present.</returns>
        public abstract bool AddGenome(string genome);

        /// <summary>
        /// Adds the given genomes to the generation
        /// </summary>
        /// <param name="Genomes"></param>
        /// <returns>Count of individuals</returns>
        public int AddGenomes(List<string> Genomes)
        {
            foreach(var genome in Genomes)
            {
                AddGenome(genome);
            }
            return _baseIndividuals.Count();
        }

        /// <summary>
        /// The lowest number of matches played by any individual
        /// </summary>
        /// <returns></returns>
        public int MinimumMatchesPlayed { get { return _baseIndividuals.Min(i => i.MatchesPlayed); } }

        public float MinScore { get { return _baseIndividuals.Min(i => i.Score); } }
        public float AvgScore { get { return _baseIndividuals.Average(i => i.Score); } }
        public float MaxScore { get { return _baseIndividuals.Max(i => i.Score); } }

        /// <summary>
        /// Picks the given number of individuals with the best scores.
        /// </summary>
        /// <param name="WinnersCount"></param>
        /// <returns>List of genomes</returns>
        public IEnumerable<string> PickWinners(int WinnersCount)
        {
            var minScore = _baseIndividuals.Min(i => i.Score);
            return _baseIndividuals.OrderByDescending(i => {
                var randomNumber = _rng.NextDouble();
                return (1 + i.AverageScore - minScore) * randomNumber;
                }).Take(WinnersCount).Select(i => i.Genome);
        }

        public override string ToString()
        {
            return string.Join(Environment.NewLine, _baseIndividuals.Select(i => i.ToString()).ToArray());
        }
    }
}
