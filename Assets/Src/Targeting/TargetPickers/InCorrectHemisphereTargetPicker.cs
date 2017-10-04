using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class InCorrectHemisphereTargetPicker : ITargetPicker
    {
        private Transform _sourceObject;
        public float ExtraScoreForValidTargets = 1000;
        public bool KullInvalidTargets = true;

        public InCorrectHemisphereTargetPicker(Transform sourceObject)
        {
            _sourceObject = sourceObject;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            potentialTargets = potentialTargets.Select(t => {
                if (t.LocationInOthersSpace(_sourceObject, null).y >= 0)
                {
                    t.IsValidForCurrentPicker = true;
                    t.Score += ExtraScoreForValidTargets;
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
