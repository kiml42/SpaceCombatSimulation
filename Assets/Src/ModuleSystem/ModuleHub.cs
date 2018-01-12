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
        public int MaxTurrets = 10;
        public int MaxModules = 15;
        public List<string> EnemyTags;
        public Color ColourOverride;

        public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
        {
            var shipToEvolve = GetComponent<Rigidbody>();
            var targetChoosingMechanism = GetComponent<IKnowsEnemyTags>();

            var velocity = shipToEvolve.velocity;

            new ShipBuilder(genomeWrapper, transform, ModuleList, TestCube)
            {
                OverrideColour = true,
                ColourOverride = ColourOverride,
                EnemyTags = targetChoosingMechanism.GetEnemyTags(),
                MaxTurrets = MaxTurrets,
                MaxModules = MaxModules,
                InitialVelocity = velocity
            }.BuildShip(false, false);

            return genomeWrapper;
        }
    }
}
