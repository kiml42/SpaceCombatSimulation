using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Evolution
{
    public class Individual
    {
        #region General
        public string Genome
        {
            get
            {
                return Summary.Genome;
            }
        }
        public SpeciesSummary Summary { get; private set; }

        public float Score { get; set; }

        public int MatchesPlayed { get; set; }

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
        /// creates an incomplete individual (before the configuration has been run)
        /// Run Finalise() once the individual has been configured.
        /// </summary>
        /// <param name="genome"></param>
        public Individual(string genome)
        {
            Summary = new SpeciesSummary(genome);
        }

        /// <summary>
        /// creates an individual with a preexisting summary can be provided.
        /// </summary>
        /// <param name="genome"></param>
        public Individual(SpeciesSummary summary)
        {
            Summary = summary;
        }

        /// <summary>
        /// Updates this individual's summary with the data from the finished genome wrapper (after all configuration has been completed)
        /// </summary>
        /// <param name="genomeWrapper">GenomeWrapper that has been used to configure the individual</param>
        public void Finalise(GenomeWrapper genomeWrapper)
        {
            Summary = new SpeciesSummary(genomeWrapper);
        }

        public override string ToString()
        {
            var matchScores = string.Join(",", MatchScores.Select(s => s.ToString()).ToArray());
            var competitorsString = string.Join(",", PreviousCombatants.Where(s => !string.IsNullOrEmpty(s)).ToArray());
            var strings = new List<string>
                {
                    Genome,
                    Score.ToString(),
                    MatchesPlayed.ToString(),
                    MatchesSurvived.ToString(),
                    CompleteKills.ToString(),
                    TotalKills.ToString(),
                    matchScores,
                    competitorsString
                };

            return string.Join(";", strings.ToArray());
        }
        #endregion

        #region BR
        public int Wins { get; set; }
        public int Draws { get; set; }
        public int Loses { get; set; }

        public List<string> PreviousCombatants = new List<string>();
        
        public string PreviousCombatantsString
        {
            get
            {
                return string.Join(",", PreviousCombatants.Where(s => !string.IsNullOrEmpty(s)).ToArray());
            }
            set
            {
                if (string.IsNullOrEmpty(value))
                {
                    PreviousCombatants = new List<string>();
                }
                else
                {
                    PreviousCombatants = value.Split(',').Where(s => !string.IsNullOrEmpty(s)).ToList();
                }
            }
        }

        public void RecordMatch(float score, List<string> allCompetitors, MatchOutcome outcome)
        {
            PreviousCombatants.AddRange(allCompetitors.Where(g => !string.IsNullOrEmpty(g) && g != Genome));
            switch (outcome)
            {
                case MatchOutcome.Win:
                    Wins++;
                    break;
                case MatchOutcome.Draw:
                    Draws++;
                    break;
                case MatchOutcome.Loss:
                    Loses++;
                    break;
            }
            Score += score;
        }

        public int CountPreviousMatchesAgainst(List<string> genomes)
        {
            var count = 0;
            foreach (var g in genomes)
            {
                count += PreviousCombatants.Count(p => p == g);
            }
            return count;
        }
        #endregion

        #region Drone
        public int MatchesSurvived;
        public int CompleteKills;
        public int TotalKills;
        public List<float> MatchScores = new List<float>();

        public string MatchScoresString
        {
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
        #endregion
    }
}
