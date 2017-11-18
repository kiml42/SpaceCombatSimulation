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
    public class GenerationTargetShooting
    {
        private System.Random _rng = new System.Random();
        private List<IndividualInGeneration> Individuals;

        public GenerationTargetShooting()
        {
            //Debug.Log("Default Constructor");
            Individuals = new List<IndividualInGeneration>();
        }

        public GenerationTargetShooting(string[] lines)
        {
            Individuals = lines.Select(l => new IndividualInGeneration(l)).ToList();
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

        private IEnumerable<IndividualInGeneration> SortGeneration()
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
            List<IndividualInGeneration> validCompetitors;
            
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

        internal class IndividualInGeneration
        {
            public string Genome;

            public float Score;
            private const int SCORE_INDEX = 1;
            public int MatchesPlayed;
            private const int MATCHES_PLAYED_INDEX = 2;
            public int MatchesSurvived;
            private const int SURVIVED_INDEX = 3;
            public int CompleteKills;
            private const int COMPLETE_KILLS_INDEX = 4;
            public int TotalKills;
            private const int TOTAL_KILLS_INDEX = 5;

            
            public List<float> MatchScores = new List<float>();
            private const int Scores_INDEX = 6;

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
                MatchesPlayed = ParsePart(parts, MATCHES_PLAYED_INDEX);
                MatchesSurvived = ParsePart(parts, SURVIVED_INDEX);
                CompleteKills = ParsePart(parts, COMPLETE_KILLS_INDEX);
                TotalKills = ParsePart(parts, TOTAL_KILLS_INDEX);

                if (parts.Length > Scores_INDEX)
                {
                    //Debug.Log(parts[PC_INDEX]);
                    var matchScoresString = parts[Scores_INDEX];
                    MatchScores = matchScoresString.Split(',').Where(s => !string.IsNullOrEmpty(s)).Select(s => float.Parse(s)).ToList();
                }
            }

            public void RecordMatch(float finalScore, bool survived, bool killedEverything, int killsThisMatch)
            {
                Score += finalScore;
                TotalKills += killsThisMatch;
                MatchesPlayed++;
                if (survived)
                {
                    MatchesSurvived++;
                }
                if (killedEverything)
                {
                    CompleteKills++;
                }
                MatchScores.Add(finalScore);
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
                var competitorsString = string.Join(",", MatchScores.Select(s => s.ToString()).ToArray());
                var strings = new List<string>
                {
                    Genome,
                    "",
                    "",
                    "",
                    "",
                    "",
                    ""
                };
                
                strings[SCORE_INDEX] = Score.ToString();
                strings[MATCHES_PLAYED_INDEX] = MatchesPlayed.ToString();
                strings[SURVIVED_INDEX] = MatchesSurvived.ToString();
                strings[COMPLETE_KILLS_INDEX] = CompleteKills.ToString();
                strings[TOTAL_KILLS_INDEX] = TotalKills.ToString();
                strings[Scores_INDEX] = competitorsString.ToString();

                return string.Join(";", strings.ToArray());
            }
        }
    }
}
