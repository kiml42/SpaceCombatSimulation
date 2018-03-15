using Assets.src.Evolution;
using Assets.Src.Interfaces;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Assets.Src.Evolution;

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
