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
        public string Tag;
        public float AdditionalScore = -10000;

        public HasTagTargetPicker(string tag)
        {
            Tag = tag;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(AdditionalScore != 0 && !string.IsNullOrEmpty(Tag))
            {
                return potentialTargets.Select(t => {
                    if(t.TargetTransform.IsValid() && t.TargetTransform.tag == Tag)
                    {
                        //Debug.Log(t.TargetTransform + " score += " + AdditionalScore);
                        t.Score += AdditionalScore;
                    }
                    return t;
                });
            }
            return potentialTargets;
        }
    }
}
