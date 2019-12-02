using System;
using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Evolution
{
    public class Generation
    {
        #region General
        private readonly Random _rng = new Random();

        public List<Individual> Individuals { get; }

        public int CountIndividuals()
        {
            return Individuals.Count();
        }

        public IEnumerable<SpeciesSummary> Summaries { get { return Individuals.Select(i => i.Summary); } }

        public Generation()
        {
            //Debug.Log("Default Constructor");
        }

        public Generation(string[] lines)
        {
            AddGenomes(lines.ToList());
        }

        public Generation(List<string> lines)
        {
            AddGenomes(lines);
        }

        public Generation(List<Individual> individuals)
        {
            Individuals = individuals;
        }

        /// <summary>
        /// Adds the given genomes to the generation
        /// </summary>
        /// <param name="Genomes"></param>
        /// <returns>Count of individuals</returns>
        public int AddGenomes(List<string> Genomes)
        {
            foreach (var genome in Genomes)
            {
                AddGenome(genome);
            }
            return Individuals.Count();
        }

        /// <summary>
        /// The lowest number of matches played by any individual
        /// </summary>
        /// <returns></returns>
        public int MinimumMatchesPlayed { get { return Individuals.Min(i => i.MatchesPlayed); } }

        public float MinScore { get { return Individuals.Min(i => i.Score); } }
        public float AvgScore { get { return Individuals.Average(i => i.Score); } }
        public float MaxScore { get { return Individuals.Max(i => i.Score); } }

        /// <summary>
        /// Picks the given number of individuals with the best scores.
        /// </summary>
        /// <param name="WinnersCount"></param>
        /// <returns>List of genomes</returns>
        public IEnumerable<string> PickWinners(int WinnersCount)
        {
            var minScore = Individuals.Min(i => i.Score);
            return Individuals.OrderByDescending(i =>
            {
                var randomNumber = _rng.NextDouble();
                return (1 + i.AverageScore - minScore) * randomNumber;
            }).Take(WinnersCount).Select(i => i.Genome);
        }

        public override string ToString()
        {
            return string.Join(Environment.NewLine, Individuals.Select(i => i.ToString()).ToArray());
        }
        
        /// <summary>
        /// Adds a new individual with the given genome.
        /// Does nothing in the case of a duplicate
        /// </summary>
        /// <param name="genome"></param>
        /// <returns>Successfully added - false id genome already present.</returns>
        public bool AddGenome(string genome)
        {
            if (Individuals.Any(i => i.Genome == genome))
            {
                return false;
            }
            Individuals.Add(new Individual(genome));
            return true;
        }

        /// <summary>
        /// Records a match for one individual by adding data to that individual.
        /// </summary>
        /// <param name="contestant">the combatant's genomes</param>
        /// <param name="finalScore">Score to add to the combatant</param>
        /// <param name="survived">True if this individual was alive at the end of the match</param>
        /// <param name="killedAllDrones">True if all the drones were killed in this match</param>
        /// <param name="killedDrones">The number of drones killed in this match</param>
        /// <param name="allCompetitors">All the individuals' genomes in the match</param>
        /// <param name="outcome">Indicator of how the individual did against the others</param>
        public void RecordMatch(GenomeWrapper contestant, float finalScore, bool survived, bool killedAllDrones, int killedDrones, List<string> allCompetitors, MatchOutcome outcome)
        {
            var individual = Individuals.First(i => i.Genome == contestant.Genome);
            individual.Finalise(contestant);
            individual.RecordMatch(finalScore, survived, killedAllDrones, killedDrones, allCompetitors, outcome);
        }
        #endregion

        #region BR

        /// <summary>
        /// Returns a genome from the individuals in this generation with the lowest number of completed matches.
        /// If any competitorsAlreadyInMatch are provided this returns the individual with the fewest matches against any of those individuals.
        /// </summary>
        /// <param name="genomeToCompeteWith"></param>
        /// <returns>genome of a competetor from this generation</returns>
        private string PickCompetitor(List<string> competitorsAlreadyInMatch)
        {
            List<Individual> validCompetitors = Individuals
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

            for (var i = 0; i < count; i++)
            {
                genomes.Add(PickCompetitor(genomes));
            }

            return genomes;
        }
        #endregion

        #region Drone

        /// <summary>
        /// Returns a genome from the individual in this generation with the lowest number of completed matches.
        /// </summary>
        /// <returns>genome of a competetor from this generation</returns>
        public string PickCompetitor()
        {
            List<Individual> validCompetitors= Individuals
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
        #endregion
    }
}
