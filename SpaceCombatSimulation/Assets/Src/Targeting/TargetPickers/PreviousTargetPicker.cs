using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Adds an additional score to the current target of the given IKnowsCurrentTarget
    /// </summary>
    public class PreviousTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public TargetChoosingMechanism CurrentTargetKnower;
        
        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(CurrentTargetKnower == null || CurrentTargetKnower.CurrentTarget == null)
            {
                if(CurrentTargetKnower == null)
                {
                    Debug.LogError(name + "'s PreviousTargetPicker Has no referenced target choosing mechanism. Parent: " + (transform.parent != null ? transform.parent.name : "(none)"));
                }
                return potentialTargets;
            }

            return potentialTargets.Select(t => {
                if(t.Target.Transform == CurrentTargetKnower.CurrentTarget.Transform)
                {
                    //Debug.Log(t.Transform.name + " gets the previous target bonus of " + BonusScore + " on top of its " + t.Score);
                    t.Score += FlatBoost;
                }
                //else
                //{
                //    Debug.Log(t.Transform.name + " gets the no previous target bonus of on top of its " + t.Score);
                //}
                return t;
            });
        }
    }
}
