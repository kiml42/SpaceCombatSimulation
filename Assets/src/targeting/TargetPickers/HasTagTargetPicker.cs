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
        public bool KullInvalidTargets = false;

        /// <summary>
        /// Set to false (default) to consider targets with the tag bad,
        /// set to true to consider targets with the tag good.
        /// Only relavent if KullInalidTargets is true.
        /// </summary>
        public bool TargetsWitTagAreValid = false;

        public HasTagTargetPicker(string tag)
        {
            Tag = tag;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(AdditionalScore != 0 && !string.IsNullOrEmpty(Tag))
            {
                return potentialTargets.Select(t => {
                    if(t.Transform.IsValid() && t.Transform.tag == Tag)
                    {
                        //Debug.Log(t.Transform + " score += " + AdditionalScore);
                        
                        t.IsValidForCurrentPicker = TargetsWitTagAreValid;
                        t.Score += AdditionalScore;
                    } else
                    {
                        //different tag
                        t.IsValidForCurrentPicker = !TargetsWitTagAreValid;
                    }
                    return t;
                });
            }
            if(KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }
            return potentialTargets;
        }
    }
}
