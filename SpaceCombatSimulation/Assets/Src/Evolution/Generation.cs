using System;
using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Evolution
{
    public class Generation
    {
        #region General
        private readonly Random _rng = new Random();

        private List<Individual> _individuals { get; }

        public int CountIndividuals()
        {
            return _individuals.Count();
        }

        public IEnumerable<SpeciesSummary> Summaries { get { return _individuals.Select(i => i.Summary); } }

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
            return _individuals.Count();
        }

        /// <summary>
        /// The lowest number of matches played by any individual
        /// </summary>
        /// <returns></returns>
        public int MinimumMatchesPlayed { get { return _individuals.Min(i => i.MatchesPlayed); } }

        public float MinScore { get { return _individuals.Min(i => i.Score); } }
        public float AvgScore { get { return _individuals.Average(i => i.Score); } }
        public float MaxScore { get { return _individuals.Max(i => i.Score); } }

        /// <summary>
        /// Picks the given number of individuals with the best scores.
        /// </summary>
        /// <param name="WinnersCount"></param>
        /// <returns>List of genomes</returns>
        public IEnumerable<string> PickWinners(int WinnersCount)
        {
            var minScore = _individuals.Min(i => i.Score);
            return _individuals.OrderByDescending(i =>
            {
                var randomNumber = _rng.NextDouble();
                return (1 + i.AverageScore - minScore) * randomNumber;
            }).Take(WinnersCount).Select(i => i.Genome);
        }

        public override string ToString()
        {
            return string.Join(Environment.NewLine, _individuals.Select(i => i.ToString()).ToArray());
        }
        
        /// <summary>
        /// Adds a new individual with the given genome.
        /// Does nothing in the case of a duplicate
        /// </summary>
        /// <param name="genome"></param>
        /// <returns>Successfully added - false id genome already present.</returns>
        public bool AddGenome(string genome)
        {
            if (_individuals.Any(i => i.Genome == genome))
            {
                return false;
            }
            _individuals.Add(new Individual(genome));
            return true;
        }
        #endregion

        #region BR
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
            var individual = _individuals.First(i => i.Genome == competitor.Genome);
            individual.Finalise(competitor);
            individual.RecordMatch(score, allCompetitors, outcome);
        }

        /// <summary>
        /// Returns a genome from the individuals in this generation with the lowest number of completed matches.
        /// If any competitorsAlreadyInMatch are provided this returns the individual with the fewest matches against any of those individuals.
        /// </summary>
        /// <param name="genomeToCompeteWith"></param>
        /// <returns>genome of a competetor from this generation</returns>
        private string PickCompetitor(List<string> competitorsAlreadyInMatch)
        {
            List<Individual> validCompetitors = _individuals
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
        public void RecordMatch(GenomeWrapper contestant, float finalScore, bool survived, bool killedEverything, int killsThisMatch)
        {
            var individual = _individuals.First(i => i.Genome == contestant.Genome);
            individual.Finalise(contestant);
            individual.RecordMatch(finalScore, survived, killedEverything, killsThisMatch);
        }

        /// <summary>
        /// Returns a genome from the individual in this generation with the lowest number of completed matches.
        /// </summary>
        /// <returns>genome of a competetor from this generation</returns>
        public string PickCompetitor()
        {
            List<Individual> validCompetitors= _individuals
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
