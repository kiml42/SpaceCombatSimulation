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
        public float AdditionalScore = 100;

        public PreviousTargetPicker(IKnowsCurrentTarget knower)
        {
            _knower = knower;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => {
                if(t.Transform == _knower.CurrentTarget.Transform)
                {
                    t.Score += AdditionalScore;
                }
                return t;
            });
        }
    }
}
