using Assets.Src.Interfaces;
using System;
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
    }
}
