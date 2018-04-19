using Assets.Src.Evolution;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Adds an additional score to targets with the given tag.
    /// Defaults to a negative score to avoid picking targets with that tag (to avoid targeting friendlies)
    /// </summary>
    public class HasTagTargetPicker : GeneticallyConfigurableTargetPicker
    {
        [Tooltip("targets with this tag are given the FlatBoost addedto their score.")]
        public string Tag;
        public bool KullInvalidTargets = false;

        ///Should this allow the FlatBoost and multiplier to have their signs flipped when configuring genetically.
        public override bool AllowNegative { get { return true; } }
        
        [Tooltip("Only applies if KullInvalidTargets is set to true. If true, targets with the given tag are considered valid and ones without are considered invalid. If false, the oposite is true.")]
        public bool TargetsWithTagAreValid = false;

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(FlatBoost != 0 && !string.IsNullOrEmpty(Tag))
            {
                return potentialTargets.Select(t => {
                    if(t.Transform.IsValid() && t.Transform.tag == Tag)
                    {
                        //Debug.Log(t.Transform + " score += " + AdditionalScore);
                        
                        t.IsValidForCurrentPicker = TargetsWithTagAreValid;
                        t.Score += FlatBoost;
                    } else
                    {
                        //different tag
                        t.IsValidForCurrentPicker = !TargetsWithTagAreValid;
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
