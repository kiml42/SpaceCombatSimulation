using Assets.src.interfaces;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Adds an additional score to targets with the given tag.
    /// Defaults to a negative score to avoid picking targets with that tag (to avoid targeting friendlies)
    /// </summary>
    class HasTagTargetPicker : ITargetPicker
    {
        private readonly string _tag;
        public float AdditionalScore = -10000;

        public HasTagTargetPicker(string tag)
        {
            _tag = tag;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => {
                if(t.TargetTransform.IsValid() && t.TargetTransform.tag == _tag)
                {
                    t.Score += AdditionalScore;
                }
                return t;
            });
        }
    }
}
