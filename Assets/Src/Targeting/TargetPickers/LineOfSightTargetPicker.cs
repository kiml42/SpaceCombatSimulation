using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class LineOfSightTargetPicker : ITargetPicker
    {
        private Transform _sourceObject;
        public float BonusForCorrectObject = 1000;

        public LineOfSightTargetPicker(Transform sourceObject)
        {
            _sourceObject = sourceObject;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => {
                var direction = t.Transform.position - _sourceObject.position;

                RaycastHit hit;
                var ray = new Ray(_sourceObject.position, direction);
                if (Physics.Raycast(ray, out hit, direction.magnitude, -1, QueryTriggerInteraction.Ignore))
                {
                    //is a hit - should always be a hit, because it's aimed at an object
                    if (hit.transform == t.Transform)
                    {
                        //is hiting correct object
                        t.Score += BonusForCorrectObject;
                    }
                }

                return t;
            });
        }
    }
}
