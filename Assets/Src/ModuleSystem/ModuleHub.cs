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
        public Color ColourOverride;
        public List<Transform> SpawnPoints;
        protected virtual bool UseJump { get; set; }

        public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
        {
            var shipToEvolve = GetComponent<Rigidbody>();
            var velocity = shipToEvolve.velocity;

            genomeWrapper = new ShipBuilder(genomeWrapper, this)
            {
                OverrideColour = true,
                ColourOverride = ColourOverride,
                InitialVelocity = velocity,
                UseJump = UseJump
            }.BuildShip(true);
            
            return genomeWrapper;
        }
    }
}
