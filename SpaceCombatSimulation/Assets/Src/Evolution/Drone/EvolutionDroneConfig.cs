using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution.Drone
{
    public class EvolutionDroneConfig
    {
        #region "Drones
        public List<int> Drones = new List<int>();

        [Tooltip("number of drones spawned = MinDronesToSpawn + #individualsWithCompleteKills * ExtraDromnesPerGeneration")]
        public int MinDronesToSpawn = 3;

        [Tooltip("number of drones spawned = MinDronesToSpawn + #individualsWithCompleteKills * ExtraDromnesPerGeneration")]
        public float ExtraDromnesPerGeneration = 0.2f;
        public int MaxDronesToSpawn = 100;
        
        public float DronesInSphereRandomRadius = 0;
        public float DronesOnSphereRandomRadius = 0;

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
                    Drones = new List<int>();
                }
                else
                {
                    var splitDronesString = value.Split(',');
                    Drones = splitDronesString.Select(d => int.Parse(d)).ToList();
                }
                    
            }
        }

        public string DroneTag = "Enemy";
        #endregion

        #region score
        [Header("Score")]
        [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
        public float KillScoreMultiplier = 300;

        [Tooltip("score for each kill = (framesRemaining * KillScoreMultiplier) + FlatKillBonus")]
        public float FlatKillBonus = 100;

        [Tooltip("Bonus Score for killing everything, timesd by remaining frames")]
        public float CompletionBonus = 100;
        #endregion
    }
}
