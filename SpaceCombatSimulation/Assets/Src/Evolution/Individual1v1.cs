using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class Individual1v1
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
        
        public Individual1v1(string genome)
        {
            Genome = genome;
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
