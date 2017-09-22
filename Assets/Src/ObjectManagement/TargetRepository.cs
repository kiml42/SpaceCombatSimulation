using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.ObjectManagement
{
    public static class TargetRepository
    {
        private static Dictionary<string, List<PotentialTarget>> _targets;

        public static void RegisterTarget(PotentialTarget target)
        {
            if(target != null && target.TargetTransform!= null && target.TargetTransform.IsValid())
            {
                var tag = target.TargetTransform.tag;
                List<PotentialTarget> list = null;
                if (!_targets.ContainsKey(tag) | _targets[tag] == null)
                {
                    list = new List<PotentialTarget>();
                    _targets[tag] = list;
                } else
                {
                    list = _targets[tag];
                }
                list.Add(target);

                _targets[tag] = CleanList(list);
            }
        }

        public static List<PotentialTarget> ListTargetsForTags(IEnumerable<string> tags)
        {
            var list = new List<PotentialTarget>();
            foreach (var tag in tags)
            {
                if (_targets.ContainsKey(tag))
                {
                    list.AddRange(CleanList(_targets[tag]));
                }
            }
            return list;
        }

        private static List<PotentialTarget> CleanList(List<PotentialTarget> list)
        {
            if(list == null)
            {
                return new List<PotentialTarget>();
            }
            return  list
                .Where(target => target != null && target.TargetTransform != null && target.TargetTransform.IsValid())
                .Distinct()
                .ToList();
        }
    }
}
