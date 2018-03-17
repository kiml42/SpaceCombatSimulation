using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Assets.Src.Evolution;
using UnityEngine;

namespace Assets.Src.ModuleSystem
{
    public class RocketTypeKnower : MonoBehaviour, IModuleTypeKnower
    {
        private static readonly List<ModuleType> _types = new List<ModuleType>
        {
            ModuleType.Projectile
        };

        public List<ModuleType> ModuleTypes
        {
            get
            {
                return _types;
            }
        }

        [Tooltip("the cost for this module when evolving ships.")]
        public float Cost = 60;

        public TargetChoosingMechanism TargetChoosingMechanism;
        public RocketController RocketController;
        public FuelTank FuelTank;
        public List<EngineControler> Engines;

        public float ModuleCost
        {
            get
            {
                return Cost;
            }
        }

        public string Name
        {
            get
            {
                return name;
            }
        }

        public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
        {
            foreach (var engine in Engines)
            {
                genomeWrapper =  engine.Configure(genomeWrapper);
            }

            genomeWrapper = TargetChoosingMechanism.Configure(genomeWrapper);
            genomeWrapper = RocketController.Configure(genomeWrapper);
            genomeWrapper = FuelTank.Configure(genomeWrapper);

            return genomeWrapper;
        }
    }
}
