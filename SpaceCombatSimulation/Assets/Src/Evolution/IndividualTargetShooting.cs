using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class IndividualTargetShooting : BaseIndividual
    {
        public int MatchesPlayed;
        public int MatchesSurvived;
        public int CompleteKills;
        public int TotalKills;
        public List<float> MatchScores = new List<float>();

        /// <summary>
        /// Construct an indifvidual from a genome, all other firelds will be empty or 0
        /// </summary>
        /// <param name="line"></param>
        public IndividualTargetShooting(string genome) : base(genome)
        {
        }

        public float AverageScore
        {
            get
            {
                if (MatchesPlayed > 0)
                {
                    return Score / MatchesPlayed;
                }
                else
                {
                    return 0;
                }
            }
        }

        public string MatchScoresString {
            get
            {
                return string.Join(",", MatchScores.Select(s => s.ToString()).ToArray());
            }
            set
            {
                //Debug.Log("Parsing '" + value + "' into match scores list.");
                if (!string.IsNullOrEmpty(value))
                {
                    var parts = value.Split(',');
                    MatchScores = parts.Select(s => float.Parse(s)).ToList();
                }
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

        public override string ToString()
        {
            var matchScores = string.Join(",", MatchScores.Select(s => s.ToString()).ToArray());
            var strings = new List<string>
                {
                    Genome,
                    Score.ToString(),
                    MatchesPlayed.ToString(),
                    MatchesSurvived.ToString(),
                    CompleteKills.ToString(),
                    TotalKills.ToString(),
                    matchScores
                };

            return string.Join(";", strings.ToArray());
        }
    }
}
