using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class InCorrectHemisphereTargetPicker : GeneticallyConfigurableTargetPicker
    {
        private Transform _sourceObject;
        public bool KullInvalidTargets = true;

        public InCorrectHemisphereTargetPicker(Transform sourceObject)
        {
            _sourceObject = sourceObject;
        }

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            potentialTargets = potentialTargets.Select(t => {
                if (t.LocationInOthersSpace(_sourceObject, null).y >= 0)
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
