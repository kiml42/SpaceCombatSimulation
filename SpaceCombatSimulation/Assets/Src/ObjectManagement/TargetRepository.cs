using Assets.Src.Controllers;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    public static class TargetRepository
    {
        private static readonly Dictionary<string, List<Target>> _targets = new Dictionary<string, List<Target>>();
        private static readonly Dictionary<string, List<Target>> _navigationTargets = new Dictionary<string, List<Target>>();

        public static void RegisterTarget(Target target)
        {
            RegisterTargetToDictionary(target, _targets);
        }

        public static void RegisterNavigationTarget(Target target)
        {
            RegisterTargetToDictionary(target, _navigationTargets);
        }

        public static void DeregisterTarget(Transform target)
        {
            var tag = target.tag;
            DeregisterTarget(target, tag);
        }

        public static void DeregisterTarget(Transform target, string tag)
        {
            DeregisterTarget(new Target(target), tag);
        }

        public static void DeregisterTarget(Target target)
        {
            var tag = target.Transform.tag;
            DeregisterTarget(target, tag);
        }

        public static void DeregisterTarget(Target target, string tag)
        {
            //Debug.Log($"deregistering target {target} with tag {tag}");
            if (!_targets.ContainsKey(tag))
            {
                if (tag != AbstractDeactivatableController.InactiveTag)
                    Debug.LogWarning($"Cannot deregister target {target} with tag {tag} - there is no list for this tag.");
                return;
            }
            var list = _targets[tag];
            var targetFromList = list.SingleOrDefault(t => t.Transform == target.Transform);
            if (targetFromList == null)
            {
                Debug.LogWarning($"Cannot deregister target {target} with tag {tag} - it is not in the list for that tag.");
                return;
            }
            list.Remove(targetFromList);
        }

        public static List<Target> ListTargetsForTags(IEnumerable<string> tags, bool includeNavigationTargets = false)
        {
            var list = new List<Target>();
            foreach (var tag in tags)
            {
                if (_targets.ContainsKey(tag))
                {
                    list.AddRange(CleanList(_targets[tag]));
                }
                if (includeNavigationTargets && _navigationTargets.ContainsKey(tag))
                {
                    list.AddRange(CleanList(_navigationTargets[tag]));
                }
            }
            return list.Distinct().ToList();
        }

        private static List<Target> CleanList(List<Target> list)
        {
            if(list == null)
            {
                return new List<Target>();
            }
            return  list
                .Where(target => target != null && target.Transform != null && target.Transform.IsValid())
                .Distinct(new CompareTargetsByTransform())  //Specify the comparer to use 
                .ToList();
        }

        private static void RegisterTargetToDictionary(Target target, Dictionary<string, List<Target>> _targets)
        {
            if (target != null && target.Transform != null && target.Transform.IsValid())
            {
                var tag = target.Transform.tag;
                if (!_targets.TryGetValue(tag, out List<Target> list) || list == null)
                {
                    list = new List<Target>();
                    _targets[tag] = list;
                }
                else
                {
                    list = _targets[tag];
                }
                list.Add(target);

                _targets[tag] = CleanList(list);
            }
        }
    }
}
