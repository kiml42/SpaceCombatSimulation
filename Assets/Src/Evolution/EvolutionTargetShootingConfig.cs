using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class EvolutionTargetShootingConfig
    {
        public int DatabaseId;
        public string RunName;

        public EvolutionMutationController MutationControl = new EvolutionMutationController();
        public EvolutionMatchController MatchControl = new EvolutionMatchController();

        #region "Drones
        public List<Rigidbody> Drones = new List<Rigidbody>();

        [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration * ExtraDromnesPerGeneration")]
        public int MinDronesToSpawn = 3;

        [Tooltip("number of drones spawned = MinDronesToSpawn + CurrentGeneration * ExtraDromnesPerGeneration")]
        public float ExtraDromnesPerGeneration = 5;
        public int MaxDronesToSpawn = 100;

        public string DronesString
        {
            get
            {
                return string.Join(";", Drones.Select(d => AssetDatabase.GetAssetPath(d)).ToArray());
            }
            set
            {
                var splitDronesString = value.Split(';');
                Drones = splitDronesString.Select(d => AssetDatabase.LoadAssetAtPath<Rigidbody>(d)).ToList();
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
