using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Target's score is alered by this function:
    ///     S = S -(distance * DistanceMultiplier)
    /// if distance < Range:
    ///     S = S + InRangeBonus
    /// as well.
    /// </summary>
    public class ProximityTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public Transform SourceObject;

        /// <summary>
        /// Remove targets outside the given range
        /// </summary>
        public bool KullInvalidTargets = true;

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            potentialTargets = potentialTargets.Select(t => AddScoreForDifference(t));
            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }
            return potentialTargets;
        }

        private PotentialTarget AddScoreForDifference(PotentialTarget target)
        {
            var dist = target.DistanceToTurret(SourceObject);
            target.Score = target.Score - (dist * Multiplier);
            if(dist < Threshold)
            {
                target.IsValidForCurrentPicker = true;
                target.Score += FlatBoost;
            } else
            {
                target.IsValidForCurrentPicker = false;
            }
            return target;
        }
    }
}
