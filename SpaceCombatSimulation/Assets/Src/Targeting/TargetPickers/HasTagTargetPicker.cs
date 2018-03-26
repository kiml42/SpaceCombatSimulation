using Assets.Src.Evolution;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Targeting.TargetPickers
{
    /// <summary>
    /// Adds an additional score to targets with the given tag.
    /// Defaults to a negative score to avoid picking targets with that tag (to avoid targeting friendlies)
    /// </summary>
    class HasTagTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public string Tag;
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

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if(FlatBoost != 0 && !string.IsNullOrEmpty(Tag))
            {
                return potentialTargets.Select(t => {
                    if(t.Transform.IsValid() && t.Transform.tag == Tag)
                    {
                        //Debug.Log(t.Transform + " score += " + AdditionalScore);
                        
                        t.IsValidForCurrentPicker = TargetsWitTagAreValid;
                        t.Score += FlatBoost;
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
