using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    public  abstract class GeneticallyConfigurableTargetPicker : GeneticConfigurableMonobehaviour, ITargetPicker
    {
        public float Threshold = 500;
        public float FlatBoost = 1000;
        public float Multiplier = 1000;

        private float MinBonus = 0;
        private float MaxBonus = 1800;

        private float MinMultiplier = 0;
        private float MaxMultiplier = 100;

        private float MinThreshold = 0;
        private float MaxThreshold = 2000;

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
            Multiplier = genomeWrapper.GetScaledNumber(MinMultiplier, MaxMultiplier);
            Threshold = genomeWrapper.GetScaledNumber(MinThreshold, MaxThreshold);
            FlatBoost = genomeWrapper.GetScaledNumber(MinBonus, MaxBonus);
           
            return genomeWrapper;
        }
    }
}
