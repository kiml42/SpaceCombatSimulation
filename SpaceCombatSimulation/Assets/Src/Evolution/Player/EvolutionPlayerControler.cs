using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution.Player
{
    public class EvolutionPlayerControler: EvolutionController
    {
        public Rigidbody PlayerShip;
        public int PlayerCount = 1;
        public float PlayerInSphereRadius = 50;
        public float PlayerOnSphereRadius = 0;
        public bool SetEnemyTagsForEachOther = true;
        public Vector3 PlayerStartLocation = Vector3.zero;


        #region Initial Setup
        protected override bool SpawnShips()
        {
            base.SpawnShips();

            var teams = ShipConfig.ShipTeamMapping.Values.ToList();
            teams.AddRange(ShipConfig.TagsForAll.Where(t => t != "RaceGoal"));

            for (int i = 0; i < PlayerCount; i++)
            {
                var location = PlayerStartLocation +
                    (Random.insideUnitSphere * PlayerInSphereRadius) +
                    (Random.onUnitSphere * PlayerOnSphereRadius);
                var ship = Instantiate(PlayerShip, location, Quaternion.identity);
                var tagKnowers = ship.GetComponentsInChildren<IKnowsEnemyTags>();
                var shipTarget = ship.GetComponentInChildren<ITarget>();
                shipTarget.SetTeam("Player1");

                foreach (var tk in tagKnowers)
                {
                    tk.KnownEnemyTags = teams;
                }
            }

            foreach (var aiShip in ShipConfig.ShipTeamMapping.Keys)
            {
                var tagKnowers = aiShip.GetComponentsInChildren<IKnowsEnemyTags>();
                foreach (var t in tagKnowers)
                {
                    t.KnownEnemyTags.Add("Player1");
                }
            }

            return true;
        }

        #endregion
    }
}
