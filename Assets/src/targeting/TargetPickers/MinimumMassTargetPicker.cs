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
    ///     S = S + (mass * MassMultiplier)
    /// if mass > MinMass:
    ///     S = S + OverMinMassBonus
    /// as well.
    /// </summary>
    class MassTargetPicker : ITargetPicker
    {
        public float MinMass = 80;
        public float OverMinMassBonus = 10000;
        public float MassMultiplier = 1;

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => {
                var rigidbody = t.Rigidbody;
                t.Score += MassMultiplier * rigidbody.mass;
                if (rigidbody.mass > MinMass)
                {
                    //Debug.Log("Adding score for mass. m=" + rigidbody.mass + ", original score = " + t.Score);
                    t.Score += OverMinMassBonus;
                }
                return t;
            });
        }
    }
}
