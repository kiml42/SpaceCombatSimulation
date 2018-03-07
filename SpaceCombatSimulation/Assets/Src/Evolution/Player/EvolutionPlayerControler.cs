using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution.Player
{
    public class EvolutionPlayerControler: EvolutionBrControler
    {
        public Rigidbody PlayerShip;
        public int PlayerCount = 1;
        public float PlayerInSphereRadius = 50;
        public float PlayerOnSphereRadius = 0;
        public bool SetEnemyTagsForEachOther = true;
        public Vector3 PlayerStartLocation = Vector3.zero;

        protected override bool SpawnShips()
        {
            ShipConfig.SetEnemyTagsForEachOther = SetEnemyTagsForEachOther;
            base.SpawnShips();
            for (int i = 0; i < PlayerCount; i++)
            {
                var location = PlayerStartLocation + 
                    (UnityEngine.Random.insideUnitSphere * PlayerInSphereRadius) + 
                    (UnityEngine.Random.onUnitSphere * PlayerOnSphereRadius);
                var ship = Instantiate(PlayerShip, location, Quaternion.identity);
                var tagKnowers =  ship.GetComponentsInChildren<IKnowsEnemyTags>();

                foreach (var tk in tagKnowers)
                {
                    tk.EnemyTags = ShipConfig.Tags;
                }
            }

            return true;
        }

        protected override bool _survivorsAreWinners
        {
            get
            {
                return SetEnemyTagsForEachOther
                    ? base._survivorsAreWinners
                    : !_shipTagsPresent.Contains("Player");
            }
        }

        protected override void AddScoreForDefeatedIndividual(KeyValuePair<string, GenomeWrapper> deadIndividual)
        {
            Debug.Log(deadIndividual.Value.Name + " has died");
            var score = -_matchControl.RemainingTime();
            _currentGeneration.RecordMatch(deadIndividual.Value, score, _allCompetetrs, MatchOutcome.Loss);
        }

        protected override void AddScoreForWinner(KeyValuePair<string, GenomeWrapper> winner)
        {
            Debug.Log(winner.Value.Name + " Wins!");
            var score = _matchControl.RemainingTime() + WinBonus;
            _currentGeneration.RecordMatch(winner.Value, score, _allCompetetrs, MatchOutcome.Win);
        }

        protected override void AddScoreSurvivingIndividualsAtTheEnd()
        {
            Debug.Log("Match over: Draw. " + _extantTeams.Count + " survived.");
            var score = WinBonus / 2;
            foreach (var team in _extantTeams)
            {
                _currentGeneration.RecordMatch(team.Value, score, _allCompetetrs, MatchOutcome.Draw);
            }
        }
    }
}
