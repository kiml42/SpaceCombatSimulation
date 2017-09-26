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

        public bool KullInvalidTargets = true;

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            //Debug.Log(potentialTargets.Count());
            potentialTargets = potentialTargets.Select(t => {
                var rigidbody = t.Rigidbody;
                t.Score += MassMultiplier * rigidbody.mass;
                if (rigidbody.mass > MinMass)
                {
                    //Debug.Log("Adding score for mass. m=" + rigidbody.mass + ", original score = " + t.Score);
                    t.IsValidForCurrentPicker = true;
                    t.Score += OverMinMassBonus;
                } else
                {
                    t.IsValidForCurrentPicker = false;
                }
                return t;
            });

            //Debug.Log(string.Join(",",potentialTargets.Select(t => t.IsValidForCurrentPicker.ToString()).ToArray()));
            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                //Debug.Log(potentialTargets.Count(t => t.IsValidForCurrentPicker) + " after kull");
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }

            return potentialTargets;
        }
    }
}
