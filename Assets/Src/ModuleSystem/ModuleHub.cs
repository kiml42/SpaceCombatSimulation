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

        public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
        {
            genomeWrapper.Jump();

            var shipToEvolve = GetComponent<Rigidbody>();
            var velocity = shipToEvolve.velocity;

            genomeWrapper = new ShipBuilder(genomeWrapper, this)
            {
                OverrideColour = true,
                ColourOverride = ColourOverride,
                InitialVelocity = velocity
            }.BuildShip(true);

            genomeWrapper.JumpBack();
            return genomeWrapper;
        }
    }
}
