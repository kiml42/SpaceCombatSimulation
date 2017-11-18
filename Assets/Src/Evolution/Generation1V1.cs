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
    public class Generation1V1 : IGeneration
    {
        private System.Random _rng = new System.Random();
        private List<IndividualInGeneration> Individuals = new List<IndividualInGeneration>();

        public Generation1V1()
        {
            //Debug.Log("Default Constructor");
        }

        public Generation1V1(string[] lines)
        {
            AddGenomes(lines.ToList());
        }

        public Generation1V1(List<string> lines)
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
            Individuals.Add(new IndividualInGeneration(genome));
            return true;
        }

        public void RecordMatch(string a, string b, string victor, float winScore, float losScore, float drawScore)
        {
            //Debug.Log("Recording Match: " + a + " vs " + b + " victor: " + victor);

            Individuals.First(i => i.Genome == a).RecordMatch(b, victor,  winScore,  losScore,  drawScore);
            Individuals.First(i => i.Genome == b).RecordMatch(a, victor,  winScore,  losScore,  drawScore);

            Individuals = Individuals.OrderByDescending(i => i.AverageScore).ToList();
        }

        public int MinimumMatchesPlayed()
        {
            return Individuals.Min(i => i.MatchesPlayed);
        }

        public IEnumerable<string> PickWinners(int WinnersCount)
        {
            return Individuals.OrderByDescending(i => i.AverageScore).ThenBy(i => _rng.NextDouble()).Take(WinnersCount).Select(i => i.Genome);
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

        internal class IndividualInGeneration
        {
            public string Genome;

            public float Score;
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

            public float AverageScore { get
                {
                    if(MatchesPlayed > 0)
                    {
                        return Score / MatchesPlayed;
                    } else
                    {
                        return 0;
                    }
                }
            }

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
                Wins = (int)ParsePart(parts, WINS_INDEX);
                Draws = (int)ParsePart(parts, DRAWS_INDEX);
                Loses = (int)ParsePart(parts, LOSES_INDEX);

                if (parts.Length > PC_INDEX)
                {
                    //Debug.Log(parts[PC_INDEX]);
                    var competitorsString = parts[PC_INDEX];
                    PreviousCombatants = competitorsString.Split(',').ToList();
                }
            }

            public void RecordMatch(string otherCompetitor, string victor, float winScore, float losScore, float drawScore)
            {
                PreviousCombatants.Add(otherCompetitor);

                if (string.IsNullOrEmpty(victor))
                {
                    Draws++;
                    Score += drawScore;
                }
                else
                {
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
                        Debug.LogWarning("Victor '" + victor + "' was not '" + Genome + "' or '" + otherCompetitor + "'");
                        Draws++;
                        Score += drawScore;
                    }
                }
            }

            private static float ParsePart(string[] parts, int index)
            {
                float retVal = 0;
                if (parts.Length > index)
                {
                    var intString = parts[index];
                    float.TryParse(intString, out retVal);
                }
                return retVal;
            }

            public override string ToString()
            {
                var competitorsString = string.Join(",", PreviousCombatants.Where(s => !string.IsNullOrEmpty(s)).ToArray());
                var strings = new List<string>
                {
                    Genome,
                    "",
                    "",
                    "",
                    "",
                    ""
                };
                
                strings[SCORE_INDEX] = Score.ToString();
                strings[WINS_INDEX] = Wins.ToString();
                strings[DRAWS_INDEX] = Draws.ToString();
                strings[LOSES_INDEX] = Loses.ToString();
                strings[PC_INDEX] = competitorsString.ToString();

                return string.Join(";", strings.ToArray());
            }
        }
    }
}
