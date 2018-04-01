using Assets.Src.Evolution;
using System.Collections.Generic;
using System.Linq;
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
    class ShipTypeTagetPicker : GeneticallyConfigurableTargetPicker
    {
        /// <summary>
        /// Ship Types to always ignore
        /// </summary>
        public List<ShipType> DisalowedTypes = new List<ShipType>
        {
            ShipType.TinyMunitions
        };

        /// <summary>
        /// ShipTypes to grant a score bonus to
        /// </summary>
        public List<ShipType> PreferdTypes = new List<ShipType>
        {
            ShipType.LargeMunitions,
            ShipType.Fighter,
            ShipType.Corvette,
            ShipType.Turret,
            ShipType.Capital,
            ShipType.SuperCapital
        };

        /// <summary>
        /// Remove targets outside the preferred range if there are any in the preferred range
        /// </summary>
        public bool KullInvalidTargets = false;
        
        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            potentialTargets = potentialTargets
                .Where(t => IsAllowed(t))                
                .Select(t => AddScoreForPrefered(t));

            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }

            return potentialTargets;
        }

        private bool IsAllowed(PotentialTarget t)
        {
            return !DisalowedTypes.Contains(t.Type);
        }

        private PotentialTarget AddScoreForPrefered(PotentialTarget target)
        {
            target.IsValidForCurrentPicker = PreferdTypes.Contains(target.Type);
            if(target.IsValidForCurrentPicker)
            {
                target.Score += FlatBoost;
            }
            return target;
        }
    }
}
