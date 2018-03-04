using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class EvolutionDroneConfig : BaseEvolutionConfig
    {
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
                if (string.IsNullOrEmpty(value))
                {
                    Debug.LogWarning("Empty Drones list was provided, no drones will spawn");
                    Drones = new List<int>();
                }
                else
                {
                    var splitDronesString = value.Split(',');
                    Drones = splitDronesString.Select(d => int.Parse(d)).ToList();
                }
                    
            }
        }
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
    }
}
