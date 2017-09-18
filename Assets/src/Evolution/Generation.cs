using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class Generation
    {
        private System.Random _rng = new System.Random();
        private Dictionary<string, IndividualInGeneration> Individuals;

        public Generation()
        {
            //Debug.Log("Default Constructor");
            Individuals = new Dictionary<string, IndividualInGeneration>();
        }

        public Generation(string[] lines)
        {
            Individuals = lines.Select(l => new IndividualInGeneration(l)).ToDictionary(i => i.Genome, i => i);
        }

        public int CountIndividuals()
        {
            return Individuals.Count;
        }

        public bool AddGenome(string genome)
        {
            if (Individuals.ContainsKey(genome))
            {
                return false;
            }
            Individuals.Add(genome, new IndividualInGeneration(genome));
            return true;
        }

        public void RecordMatch(string a, string b, string victor, int winScore, int losScore, int drawScore)
        {
            Debug.Log("Recording Match: " + a + " vs " + b + " victor: " + victor);

            Individuals[a].RecordMatch(b, victor,  winScore,  losScore,  drawScore);
            Individuals[b].RecordMatch(a, victor,  winScore,  losScore,  drawScore);

            Individuals = Individuals.OrderByDescending(i => i.Value.Score).ToDictionary(i => i.Key, i=> i.Value);
        }

        public int MinimumMatchesPlayed()
        {
            return Individuals.Values.Min(i => i.MatchesPlayed);
        }

        public IEnumerable<string> PickWinners(int WinnersCount)
        {
            return Individuals.Values.OrderByDescending(i => i.Score).ThenBy(i => _rng.NextDouble()).Take(WinnersCount).Select(i => i.Genome);
        }

        /// <summary>
        /// Returns a genome from the individuals in this generation with the lowest number of completed matches.
        /// If a non-empty genome is provded, the genome provided will not be that one, or be one that has already competed with that one.
        /// </summary>
        /// <param name="genomeToCompeteWith"></param>
        /// <returns>genome of a competetor from this generation</returns>
        public string PickCompetitor(string genomeToCompeteWith = null)
        {
            List<IndividualInGeneration> validCompetitors;

            if (!string.IsNullOrEmpty(genomeToCompeteWith))
            {
                validCompetitors = Individuals.Values
                    .Where(i => i.Genome != genomeToCompeteWith && !i.PreviousCombatants.Contains(genomeToCompeteWith))
                    .OrderBy(i => i.MatchesPlayed)
                    .ThenBy(i => _rng.NextDouble())
                    .ToList();
            } else
            {
                validCompetitors = Individuals.Values
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

        public override string ToString()
        {
            return string.Join(Environment.NewLine, Individuals.Values.Select(i => i.ToString()).ToArray());
        }

        internal class IndividualInGeneration
        {
            public string Genome;

            public int Score;
            private const int SCORE_INDEX = 1;
            public int Wins;
            private const int WINS_INDEX = 2;
            public int Draws;
            private const int DRAWS_INDEX = 3;
            public int Loses;
            private const int LOSES_INDEX = 4;

            public int MatchesPlayed { get { return Wins + Draws + Loses; } }

            public List<string> PreviousCombatants = new List<string>();
            private const int PC_INDEX = 5;

            private const int WIN_SCORE = 10;
            private const int DRAW_SCORE = -2;
            private const int LOOSE_SCORE = -10;

            /// <summary>
            /// Construct from a generation line.
            /// If one section (i.e. no semicolons) is given, it will be interpereted as a new genome with no matches completed.
            /// </summary>
            /// <param name="line"></param>
            public IndividualInGeneration(string line)
            {
                var parts = line.Split(';');
                //Debug.Log(parts.Length);
                Genome = parts[0];
                Score = ParsePart(parts, SCORE_INDEX);
                Wins = ParsePart(parts, WINS_INDEX);
                Draws = ParsePart(parts, DRAWS_INDEX);
                Loses = ParsePart(parts, LOSES_INDEX);

                if (parts.Length > PC_INDEX)
                {
                    //Debug.Log(parts[PC_INDEX]);
                    var competitorsString = parts[PC_INDEX];
                    PreviousCombatants = competitorsString.Split(',').ToList();
                }
            }

            public void RecordMatch(string otherCompetitor, string victor, int winScore, int losScore, int drawScore)
            {
                PreviousCombatants.Add(otherCompetitor);

                if (Genome == victor)
                {
                    Wins++;
                    Score += winScore;
                }
                else if (victor == otherCompetitor)
                {
                    Loses++;
                    Score += losScore;
                }
                else
                {
                    Draws++;
                    Score += drawScore;
                }
            }

            private static int ParsePart(string[] parts, int index)
            {
                int retVal = 0;
                if (parts.Length > index)
                {
                    var intString = parts[index];
                    int.TryParse(intString, out retVal);
                }
                return retVal;
            }

            public override string ToString()
            {
                var competitorsString = string.Join(",", PreviousCombatants.ToArray());
                return Genome + ";" + Score + ";" + Wins + ";" + Draws + ";" + Loses + ";" + competitorsString;
            }
        }
    }
}
