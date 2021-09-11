﻿using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ModuleSystem
{
    public class ModuleTypeKnower : GeneticConfigurableMonobehaviour, IModuleTypeKnower
    {
        [Tooltip("the list of types that this module can act as.")]
        public List<ModuleType> Types;

        [Tooltip("the cost for this module when evolving ships.")]
        public float Cost = 100;

        public float ModuleCost
        {
            get
            {
                return Cost;
            }
        }

        [Tooltip("Configurable modules on other objects")]
        public List<IModuleTypeKnower> ExtraConfigurables = new List<IModuleTypeKnower>();

        public List<ModuleType> ModuleTypes
        {
            get
            {
                return Types;
            }
        }

        public string Name
        {
            get
            {
                return name;
            }
        }


        //[Tooltip("These components will be configured in order by this behaviour when Configure is called on it.")]
        //public List<IGeneticConfigurable> ComponentsToConfigure = new List<IGeneticConfigurable>();

        protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
        {
            var componentsToConfigure = GetComponentsInChildren<IGeneticConfigurable>().ToList();

            componentsToConfigure.AddRange(ExtraConfigurables.Where(c => c != null).Select(c => c as IGeneticConfigurable));

            componentsToConfigure = componentsToConfigure.Distinct().Where(c => c != null && c.GetType() != GetType()).ToList();
            
            foreach (var c in componentsToConfigure)
            {
                genomeWrapper.Jump();
                genomeWrapper = c.Configure(genomeWrapper);
                genomeWrapper.JumpBack();
            }

            return genomeWrapper;
        }
    }
}
