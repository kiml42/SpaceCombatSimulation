using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public class EvolutionShipConfig : MonoBehaviour
    {
        public ModuleTypeKnower ShipToEvolve;

        public List<string> Tags = new List<string> { "Team1", "Team2", "Team3", "Team4", "Team5", "Team6" };

        [Tooltip("all spawned ships get these set as their enemies")]
        public List<string> TagsForAll = new List<string> { "RaceGoal", "Enemy" };

        public TestCubeChecker TestCube;
        [Tooltip("Randomise the rotation of all spawned ships")]
        public string SpaceShipTag = "SpaceShip";

        public ModuleList ModuleList;
        public int MaxTurrets = 10;
        public int MaxModules = 15;
        public float? Budget = 1000;

        public MatchConfig Config;

        public Dictionary<Transform, string> ShipTeamMapping = new Dictionary<Transform, string>();

        /// <summary>
        /// Spawns a ship with the given genome.
        /// </summary>
        /// <param name="genome"></param>
        /// <param name="spawnPointNumber"></param>
        /// <param name="totalNumberOfSpawnPoints"></param>
        /// <returns>Returns the GenomeWrapper for that ship.</returns>
        public GenomeWrapper SpawnShip(string genome, int spawnPointNumber, int totalNumberOfSpawnPoints)
        {
            if (Config == null)
            {
                throw new Exception("EvolutionShipConfig needs to have its Config set to a valid MatchConfig");
            }

            var location = Config.PositionForCompetitor(spawnPointNumber, totalNumberOfSpawnPoints);
            var orientation = Config.OrientationForStartLocation(location);
            var velocity = Config.VelocityForStartLocation(location);

            var ownTag = GetTag(spawnPointNumber);

            var ship = Instantiate(ShipToEvolve, location, orientation);
            ship.tag = ownTag;

            var hub = ship.GetComponent<ModuleHub>();
            if (hub != null)
            {
                hub.AllowedModuleIndicies = Config.AllowedModuleIndicies;
            }

            var tagShource = ship.GetComponent<IKnowsEnemyTags>();
            var enemyTags = Tags.Where(t => t != ownTag).ToList();
            enemyTags.AddRange(TagsForAll);

            if (tagShource != null)
            {
                tagShource.KnownEnemyTags = enemyTags;
            }
            else
            {
                Debug.LogError(ship.name + " Has no IKnowsEnemyTags available.");
            }

            var genomeWrapper = new GenomeWrapper(genome)
            {
                Budget = Config.Budget,
                Tag = ownTag
            };
            ship.GetComponent<Rigidbody>().velocity = velocity;

            genomeWrapper = ship.Configure(genomeWrapper);

            ship.name = genomeWrapper.Name;

            ShipTeamMapping[ship.transform] = ownTag;

            return genomeWrapper;
        }

        public string GetTag(int index)
        {
            if (!Tags.Any())
            {
                throw new Exception("The Tags list is empty");
            }
            var tagIndex = index % Tags.Count;

            return Tags[tagIndex];
        }
    }

}