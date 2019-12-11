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
        public GenomeWrapper SpawnShip(string genome, int spawnPointNumber, int totalNumberOfSpawnPoints, float stepsForwards)
        {
            if (Config == null)
            {
                throw new Exception("EvolutionShipConfig needs to have its Config set to a valid MatchConfig");
            }

            var location = Config.PositionForCompetitor(spawnPointNumber, totalNumberOfSpawnPoints, stepsForwards);
            var orientation = Config.OrientationForStartLocation(location);
            var velocity = Config.VelocityForStartLocation(location);

            var ownTeam = $"Team{spawnPointNumber}";

            var ship = Instantiate(ShipToEvolve, location, orientation);
            ship.GetComponent<ITarget>().SetTeam(ownTeam);

            var hub = ship.GetComponent<ModuleHub>();
            if (hub != null)
            {
                hub.AllowedModuleIndicies = Config.AllowedModuleIndicies;
            }

            var genomeWrapper = new GenomeWrapper(genome)
            {
                Budget = Config.Budget,
                Team = ownTeam
            };
            ship.GetComponent<Rigidbody>().velocity = velocity;

            genomeWrapper = ship.Configure(genomeWrapper);

            ship.name = genomeWrapper.Name;

            ShipTeamMapping[ship.transform] = ownTeam;

            return genomeWrapper;
        }
    }

}