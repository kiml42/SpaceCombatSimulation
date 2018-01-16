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
        public List<string> EnemyTags;
        public Color ColourOverride;

        public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
        {
            var shipToEvolve = GetComponent<Rigidbody>();
            var targetChoosingMechanism = GetComponent<IKnowsEnemyTags>();

            var velocity = shipToEvolve.velocity;

            return new ShipBuilder(genomeWrapper, transform, ModuleList, TestCube)
            {
                OverrideColour = true,
                ColourOverride = ColourOverride,
                EnemyTags = targetChoosingMechanism.GetEnemyTags(),
                InitialVelocity = velocity
            }.BuildShip(false, false);
        }
    }
}
