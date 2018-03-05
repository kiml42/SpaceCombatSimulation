using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class IndividualBr : BaseIndividual
    {
        public int Wins { get; set; }
        public int Draws { get; set; }
        public int Loses { get; set; }

        public override int MatchesPlayed { get { return Wins + Draws + Loses; } set { throw new NotImplementedException("Cannot set MatchesPlayed on IndividualBr"); } }

        public List<string> PreviousCombatants = new List<string>();

        public IndividualBr(string genome) : base(genome)
        {
        }

        public IndividualBr(SpeciesSummary summary) : base(summary)
        {
        }

        public string PreviousCombatantsString {
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

        public override string ToString()
        {
            var competitorsString = string.Join(",", PreviousCombatants.Where(s => !string.IsNullOrEmpty(s)).ToArray());
            var strings = new List<string>
                {
                    Genome,
                    Score.ToString(),
                    competitorsString.ToString()
                };

            return string.Join(";", strings.ToArray());
        }
    }
}
