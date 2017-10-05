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
    class ShipTypeTagetPicker : ITargetPicker
    {
        /// <summary>
        /// Will discard targets with a smaller type than this
        /// </summary>
        public ShipType AbsoluteMinimum = ShipType.SmallMunitions;

        /// <summary>
        /// Will grant bonus score for targets in the prefered range
        /// </summary>
        public ShipType PreferedMinimum = ShipType.LargeMunitions;

        /// <summary>
        /// Will grant bonus score for targets in the prefered range
        /// </summary>
        public ShipType PreferedMaximum = ShipType.SuperCapital;

        /// <summary>
        /// Will discard targets with a larger type than this
        /// </summary>
        public ShipType AbsoluteMaximum = ShipType.SuperCapital;

        public float PreferedTypeBonus = 100;

        /// <summary>
        /// Remove targets outside the preferred range if there are any in the preferred range
        /// </summary>
        public bool KullInvalidTargets = false;
        
        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            potentialTargets = potentialTargets
                .Where(t => IsInAbsoluteRange(t))                
                .Select(t => AddScoreForDifference(t));

            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }

            return potentialTargets;
        }

        private bool IsInAbsoluteRange(PotentialTarget t)
        {
            var type = t.Type;
            return type >= AbsoluteMinimum && type <= AbsoluteMaximum;
        }

        private PotentialTarget AddScoreForDifference(PotentialTarget target)
        {
            var type = target.Type;

            target.IsValidForCurrentPicker = type >= PreferedMinimum && type <= PreferedMaximum;
            if(target.IsValidForCurrentPicker)
            {
                target.Score += PreferedTypeBonus;
            }
            return target;
        }
    }
}
