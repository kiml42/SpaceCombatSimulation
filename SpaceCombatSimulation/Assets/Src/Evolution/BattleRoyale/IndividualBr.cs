using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class IndividualBr : BaseIndividual
    {
        public int Wins;
        public int Draws;
        public int Loses;

        public override int MatchesPlayed { get { return Wins + Draws + Loses; } set { throw new NotImplementedException("Cannot set MatchesPlayed on Individual1v1"); } }

        public List<string> PreviousCombatants = new List<string>();

        private const int WIN_SCORE = 10;
        private const int DRAW_SCORE = -2;
        private const int LOOSE_SCORE = -10;

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
                PreviousCombatants = value.Split(',').Where(s => !string.IsNullOrEmpty(s)).ToList();
            }
        }

        public void RecordMatch(string otherCompetitor, string victor, float winScore, float losScore, float drawScore)
        {
            PreviousCombatants.Add(otherCompetitor);

            if (string.IsNullOrEmpty(victor))
            {
                Debug.Log("Draw");
                Draws++;
                Score += drawScore;
            }
            else
            {
                if (Summary.Genome == victor)
                {
                    Debug.Log(Summary.GetName() + " Wins!");
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
                     Wins.ToString(),
                    Draws.ToString(),
                    Loses.ToString(),
                   competitorsString.ToString()
                };

            return string.Join(";", strings.ToArray());
        }
    }
}
