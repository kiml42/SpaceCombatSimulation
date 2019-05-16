using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.ObjectManagement
{
    public static class TargetRepository
    {
        private static readonly Dictionary<string, List<Target>> _targets = new Dictionary<string, List<Target>>();

        public static void RegisterTarget(Target target)
        {
            if (target != null && target.Transform != null && target.Transform.IsValid())
            {
                var tag = target.Transform.tag;
                var exists = _targets.TryGetValue(tag, out var list);
                if (!exists)
                {
                    list = new List<Target>();
                }
                list.Add(target);

                _targets[tag] = CleanList(list);
            }
        }

        public static void DeregisterTarget(Target target)
        {
            if (target != null && target.Transform != null && target.Transform.IsValid())
            {
                var tag = target.Transform.tag;
                var exists = _targets.TryGetValue(tag, out var list);
                if (exists)
                {
                    list.Remove(target);
                    _targets[tag] = CleanList(list);
                }
            }
        }

        public static List<Target> ListTargetsForTags(IEnumerable<string> tags)
        {
            var list = new List<Target>();
            foreach (var tag in tags)
            {
                if (_targets.ContainsKey(tag))
                {
                    list.AddRange(CleanList(_targets[tag]));
                }
            }
            return list;
        }

        private static List<Target> CleanList(List<Target> list)
        {
            if (list == null)
            {
                return new List<Target>();
            }
            return list
                .Where(target => target != null && target.Transform != null && target.Transform.IsValid())
                .Distinct(new CompareTargetsByTransform())  //Specify the comparer to use 
                .ToList();
        }
    }
}
