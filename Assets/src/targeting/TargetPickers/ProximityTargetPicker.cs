using Assets.Src.Interfaces;
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
    class ProximityTargetPicker : ITargetPicker
    {
        private Transform _sourceObject;
        public float Range = 500;
        public float InRangeBonus = 0;
        public float DistanceMultiplier = 1;

        /// <summary>
        /// Remove targets outside the given range
        /// </summary>
        public bool KullInvalidTargets = true;

        public ProximityTargetPicker(Rigidbody sourceObject)
        {
            _sourceObject = sourceObject.transform;
        }

        public ProximityTargetPicker(Transform sourceObject)
        {
            _sourceObject = sourceObject;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
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
            var dist = target.DistanceToTurret(_sourceObject);
            target.Score = target.Score - (dist * DistanceMultiplier);
            if(dist < Range)
            {
                target.IsValidForCurrentPicker = true;
                target.Score += InRangeBonus;
            } else
            {
                target.IsValidForCurrentPicker = false;
            }
            return target;
        }
    }
}
