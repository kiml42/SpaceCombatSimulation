using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class EvolutionTargetShootingConfig
    {
        public int DatabaseId;
        public string RunName;

        public MutationConfig MutationConfig = new MutationConfig();
        public MatchConfig MatchConfig = new MatchConfig();

        #region "Drones
        public List<int> Drones = new List<int>();

        [Tooltip("number of drones spawned = MinDronesToSpawn + #individualsWithCompleteKills * ExtraDromnesPerGeneration")]
        public int MinDronesToSpawn = 3;

        [Tooltip("number of drones spawned = MinDronesToSpawn + #individualsWithCompleteKills * ExtraDromnesPerGeneration")]
        public float ExtraDromnesPerGeneration = 0.2f;
        public int MaxDronesToSpawn = 100;

        public string DronesString
        {
            get
            {
                return string.Join(",", Drones.Select(d => d.ToString()).ToArray());
            }
            set
            {
                if (value.Contains(";"))
                    Debug.LogWarning("Use of ; as a delimiter is obsolete, use , instead.");
                if (string.IsNullOrEmpty(value))
                {
                    Debug.LogWarning("Empty Drones list was provided, no drones will spawn");
                    Drones = new List<int>();
                }
                else
                {
                    var splitDronesString = value.Split(';', ',');
                    Drones = splitDronesString.Select(d => int.Parse(d)).ToList();
                }
                    
            }
        }
        #endregion

        #region Generation Setup
        [Header("Generation setup")]
        [Tooltip("The generation is over when every individual has had at least this many matches.")]
        public int MinMatchesPerIndividual = 1;

        [Tooltip("The number of individuals to keep for the next generation")]
        public int WinnersFromEachGeneration = 5;
        #endregion

        #region score
        [Header("Score")]
        [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
        public float KillScoreMultiplier = 300;

        [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
        public float FlatKillBonus = 100;

        [Tooltip("Bonus Score for killing everything, timesd by remaining frames")]
        public float CompletionBonus = 100;

        [Tooltip("penalty for dieing, multiplied by remining frames")]
        public float DeathPenalty = 70;
        #endregion

        public int GenerationNumber;
    }
}
