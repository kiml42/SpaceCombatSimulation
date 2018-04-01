using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class InCorrectHemisphereTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public Transform SourceObject;
        public bool KullInvalidTargets = true;

        public InCorrectHemisphereTargetPicker(Transform sourceObject)
        {
            SourceObject = sourceObject;
        }

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            potentialTargets = potentialTargets.Select(t => {
                if (t.LocationInOthersSpace(SourceObject, null).y >= 0)
                {
                    t.IsValidForCurrentPicker = true;
                    t.Score += FlatBoost;
                } else
                {
                    t.IsValidForCurrentPicker = false;
                }
                return t;
            }
            );
            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }

            return potentialTargets;
        }
    }
}
