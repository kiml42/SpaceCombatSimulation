using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Adds an additional score to the current target of the given IKnowsCurrentTarget
    /// </summary>
    class PreviousTargetPicker : GeneticallyConfigurableTargetPicker
    {
        private readonly IKnowsCurrentTarget _knower;

        public PreviousTargetPicker(IKnowsCurrentTarget knower)
        {
            _knower = knower;
        }

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(_knower.CurrentTarget == null)
            {
                return potentialTargets;
            }

            return potentialTargets.Select(t => {
                if(t.Transform == _knower.CurrentTarget.Transform)
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
