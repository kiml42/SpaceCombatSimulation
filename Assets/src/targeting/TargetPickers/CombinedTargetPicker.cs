using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Targeting
{
    public class CombinedTargetPicker : ITargetPicker
    {
        private IEnumerable<ITargetPicker> _targeters;
        public CombinedTargetPicker(IEnumerable<ITargetPicker> targeters)
        {
            _targeters = targeters;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            foreach (var targeter in _targeters)
            {
                potentialTargets = targeter.FilterTargets(potentialTargets);
            }
            return potentialTargets;
        }
    }
}
