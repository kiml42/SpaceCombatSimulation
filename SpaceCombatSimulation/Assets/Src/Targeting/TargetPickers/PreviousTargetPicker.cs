using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Adds an additional score to the current target of the given IKnowsCurrentTarget
    /// </summary>
    class PreviousTargetPicker : ITargetPicker
    {
        private readonly IKnowsCurrentTarget _knower;
        public float BonusScore;

        public PreviousTargetPicker(IKnowsCurrentTarget knower, float bonusScore = 100)
        {
            _knower = knower;
            BonusScore = bonusScore;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(_knower.CurrentTarget == null)
            {
                return potentialTargets;
            }

            return potentialTargets.Select(t => {
                if(t.Transform == _knower.CurrentTarget.Transform)
                {
                    //Debug.Log(t.Transform.name + " gets the previous target bonus of " + BonusScore + " on top of its " + t.Score);
                    t.Score += BonusScore;
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
