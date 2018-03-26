using Assets.Src.Evolution;
using System.Collections.Generic;
using System.Linq;
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
    class MassTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public bool KullInvalidTargets = true;

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            //Debug.Log(potentialTargets.Count());
            potentialTargets = potentialTargets.Select(t => {
                var rigidbody = t.Rigidbody;
                t.Score += Multiplier * rigidbody.mass;
                if (rigidbody.mass > Threshold)
                {
                    //Debug.Log("Adding score for mass. m=" + rigidbody.mass + ", original score = " + t.Score);
                    t.IsValidForCurrentPicker = true;
                    t.Score += FlatBoost;
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
