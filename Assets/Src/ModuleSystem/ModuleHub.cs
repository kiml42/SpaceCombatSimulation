using Assets.src.Evolution;
using Assets.Src.Interfaces;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Assets.Src.Evolution;

namespace Assets.Src.ModuleSystem
{
    public class ModuleHub : MonoBehaviour, IGeneticConfigurable
    {
        public TestCubeChecker TestCube;
        public ModuleList ModuleList;
        public List<Transform> SpawnPoints;
        public List<int> AllowedModuleIndicies = null;

        public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
        {
            var shipToEvolve = GetComponent<Rigidbody>();
            var velocity = shipToEvolve.velocity;

            genomeWrapper = new ShipBuilder(genomeWrapper, this)
            {
                InitialVelocity = velocity,
                AllowedModuleIndicies = AllowedModuleIndicies
            }.BuildShip(true);
            
            return genomeWrapper;
        }
    }
}
