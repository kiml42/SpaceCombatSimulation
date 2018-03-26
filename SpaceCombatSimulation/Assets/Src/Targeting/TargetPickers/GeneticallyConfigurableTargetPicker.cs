using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    abstract class GeneticallyConfigurableTargetPicker : GeneticConfigurableMonobehaviour, ITargetPicker
    {
        public float Threshold = 500;
        public float FlatBoost = 0;
        public float Multiplier = 1;

        public float MinBonus = 0;
        public float DefaultBonus = 0;
        public float MaxBonus = 1800;

        public float MinMultiplier = 0;
        public float DefaultMultiplier = 0;
        public float MaxMultiplier = 100;

        public float MinThreshold = 0;
        public float DefaultThreshold = 0;
        public float MaxThreshold = 2000;

        [Tooltip("Target pickers are used in ascending priority order." +
            "If targets are discarded by a low priority targeter higher priority targeters won't get to judge them at all.")]
        public float Priority = 0;

        public float TargetPickerPriority
        {
            get
            {
                return Priority;
            }
        }
        
        public abstract IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets);

        protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
        {
            Multiplier = genomeWrapper.GetScaledNumber(MaxMultiplier);
            Threshold = genomeWrapper.GetScaledNumber(2000);
            FlatBoost = genomeWrapper.GetScaledNumber(MaxBonus);
           
            return genomeWrapper;
        }
    }
}
