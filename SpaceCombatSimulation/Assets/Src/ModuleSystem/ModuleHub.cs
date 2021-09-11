using Assets.src.Evolution;
using Assets.Src.Evolution;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.ModuleSystem
{
    public class ModuleHub : GeneticConfigurableMonobehaviour
    {
        public TestCubeChecker TestCube;
        public ModuleList ModuleList;
        public List<Transform> SpawnPoints;
        public int[] AllowedModuleIndicies = null;

        public Vector3 Velocity { get { return GetComponent<Rigidbody>().velocity; } }

        protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
        {
            genomeWrapper = new ShipBuilder(genomeWrapper, this).BuildShip(true);

            return genomeWrapper;
        }
    }
}
