using Assets.Src.ObjectManagement;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Target's score is altered by this function:
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

        public void Start()
        {
            SourceObject = SourceObject != null ? SourceObject : transform.root;
        }

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(SourceObject == null)
            {
                Debug.LogError($"{this} has no source object");
                return potentialTargets;
            }
            potentialTargets = potentialTargets
                .Where(t => t?.Target?.Transform?.IsValid() == true)
                .Select(t => AddScoreForDifference(t));
            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }
            return potentialTargets;
        }

        private PotentialTarget AddScoreForDifference(PotentialTarget target)
        {
            var dist = target?.DistanceToTurret(SourceObject);
            if (!dist.HasValue)
            {
                target.IsValidForCurrentPicker = false;
                return target;
            }
            target.Score = target.Score - (dist.Value * Multiplier);
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
