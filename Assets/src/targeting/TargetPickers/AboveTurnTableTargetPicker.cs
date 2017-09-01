using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class AboveTurnTableTargetPicker : ITargetPicker
    {
        private Rigidbody _sourceObject;
        public float ExtraScoreForValidTargets = 1000;

        public AboveTurnTableTargetPicker(Rigidbody sourceObject)
        {
            _sourceObject = sourceObject;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => {
                if (t.LocationInOtherTransformSpace(_sourceObject, null).y >= 0)
                {
                    t.Score += ExtraScoreForValidTargets;
                }
                return t;
            }
            );
        }
    }
}
