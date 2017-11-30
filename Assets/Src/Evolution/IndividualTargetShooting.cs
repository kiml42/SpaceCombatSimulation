using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public class IndividualTargetShooting
    {
        public string Genome;

        public float Score;
        public int MatchesPlayed;
        public int MatchesSurvived;
        public int CompleteKills;
        public int TotalKills;
        public List<float> MatchScores = new List<float>();

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

        /// <summary>
        /// Construct an indifvidual from a genome, all other firelds will be empty or 0
        /// </summary>
        /// <param name="line"></param>
        public IndividualTargetShooting(string genome)
        {
            Genome = genome;
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
