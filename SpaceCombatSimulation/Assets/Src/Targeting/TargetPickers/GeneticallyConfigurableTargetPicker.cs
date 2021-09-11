﻿using Assets.Src.Evolution;
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

        ///Should this allow the FlatBoost and multiplier to have their signs flipped when configuring genetically.
        public virtual bool AllowNegative { get { return false; } }

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
            Multiplier = genomeWrapper.GetScaledNumber(Multiplier * 2, AllowNegative ? -Multiplier * 2 : 0);
            Threshold = genomeWrapper.GetScaledNumber(Threshold * 2);
            FlatBoost = genomeWrapper.GetScaledNumber(FlatBoost * 2, AllowNegative ? -FlatBoost * 2 : 0);
           
            return genomeWrapper;
        }
    }
}
