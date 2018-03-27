using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class LineOfSightTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public Transform SourceObject;
        public bool KullInvalidTargets = true;
        public float MinDetectionDistance = 2;

        public LineOfSightTargetPicker(Transform sourceObject)
        {
            SourceObject = sourceObject;
        }

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            potentialTargets =  potentialTargets.Select(t => {
                var direction = t.Transform.position - SourceObject.position;

                RaycastHit hit;
                var ray = new Ray(SourceObject.position + (direction * MinDetectionDistance), direction);
                if (Physics.Raycast(ray, out hit, direction.magnitude, -1, QueryTriggerInteraction.Ignore))
                {
                    //is a hit - should always be a hit, because it's aimed at an object
                    if (hit.transform == t.Transform)
                    {
                        //is hiting correct object
                        t.IsValidForCurrentPicker = true;
                        t.Score += FlatBoost;
                    } else
                    {
                        t.IsValidForCurrentPicker = false;
                    }
                }

                return t;
            });

            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }
            return potentialTargets;
        }
    }
}
