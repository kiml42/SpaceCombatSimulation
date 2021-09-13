using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    public static class TargetRepository
    {
        private static readonly Dictionary<string, List<ITarget>> _targets = new Dictionary<string, List<ITarget>>();

        public static void RegisterTarget(ITarget target)
        {
            if (target != null && target.Transform != null && target.Transform.IsValid())
            {
                var tag = target.Team;
                if (!_targets.TryGetValue(tag, out List<ITarget> list) || list == null)
                {
                    list = new List<ITarget>();
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

        public static void DeregisterTarget(ITarget target)
        {
            var team = target.Team;
            if (string.IsNullOrEmpty(team))
            {
                Debug.LogWarning($"Cannot remove \"{target}\" from \"{team}\", it is null or empty.");
                return;
            }
            //Debug.Log($"deregistering target {target} with tag {tag}");

            var list = _targets[team];
            var targetFromList = list.SingleOrDefault(t => t.Transform == target.Transform);
            if (targetFromList == null)
            {
                Debug.LogWarning($"Cannot deregister target {target} with tag {team} - it is not in the list for that tag.");
                return;
            }
            list.Remove(targetFromList);
        }

        public static IEnumerable<ITarget> ListTargetsOnTeams(IEnumerable<string> teams, bool includeNavigationTargets = false, bool includeAtackTargets = true)
        {
            if(!includeAtackTargets && !includeNavigationTargets)
            {
                Debug.LogWarning("Must include navigational targets, attack targets or both to get any targets returned.");
                return Enumerable.Empty<ITarget>();
            }

            var list = new List<ITarget>();
            foreach (var team in teams)
            {
                if (_targets.ContainsKey(team))
                {
                    var onTeam = CleanList(_targets[team]).Where(t => t.NavigationalTarget && includeNavigationTargets || t.AtackTarget && includeAtackTargets);
                    //Debug.Log($"team {team} has {_targets[team].Count()} targets, of which {onTeam.Count()} are valid. Nav: {includeNavigationTargets}, Attack: {includeAtackTargets}");
                    list.AddRange(onTeam);
                }
                else
                {
                    Debug.LogWarning($"target list for team {team}, creating one to suppress warning.");
                    _targets[team] = new List<ITarget>();
                }
            }
            var distinctList = list.Distinct();

            return distinctList;
        }

        private static List<ITarget> CleanList(List<ITarget> list)
        {
            if (list == null)
            {
                return new List<ITarget>();
            }
            return list
                .Where(target => target != null && target.Transform != null && target.Transform.IsValid())
                .Distinct(new CompareTargetsByTransform())  //Specify the comparer to use 
                .ToList();
        }
    }
}
