using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class MinimumMassTargetPicker : ITargetPicker
    {
        private float _minMass;
        public float AdditionalScore = 10000;

        public MinimumMassTargetPicker(float minMass)
        {
            _minMass = minMass;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => {
                var rigidbody = t.TargetRigidbody.GetComponent("Rigidbody") as Rigidbody;
                if (rigidbody == null)
                {
                    t.Score -= AdditionalScore;
                    return t;
                }
                if (rigidbody.mass > _minMass)
                {
                    //Debug.Log("Adding score for mass. m=" + rigidbody.mass + ", original score = " + t.Score);
                    t.Score += AdditionalScore;
                }
                return t;
            });
        }
    }
}
