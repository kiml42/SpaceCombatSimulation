using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class CombinedTargetPicker : MonoBehaviour, ITargetPicker
    {
        public bool Log = false;

        private IOrderedEnumerable<ITargetPicker> _targeters;

        void Start()
        {
            var pickers = GetComponents<ITargetPicker>();
            _targeters = pickers.Where(p => p.GetType() != GetType()).OrderBy(p => p.TargetPickerPriority);
            if (!_targeters.Any()) Debug.LogWarning(this + " has no target pickers!");
        }

        public float TargetPickerPriority
        {
            get
            {
                return _targeters.First().TargetPickerPriority;
            }
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            if (_targeters == null || !_targeters.Any())
            {
                //Debug.Log(this + " has no target pickers! (might just not be initialised yet, attempting reinitialisation...)");
                Start();

                if (_targeters == null || !_targeters.Any())
                {
                    Debug.LogError(name + " still has no target pickers!");
                }
            }
            if(Log)
                Debug.Log($"Original targets: {string.Join(",", potentialTargets)}");
            foreach (var targeter in _targeters)
            {
                potentialTargets = targeter.FilterTargets(potentialTargets);
                if(Log)
                    Debug.Log($"After {targeter}: {string.Join(",", potentialTargets)}");
            }
            if(Log)
                Debug.Log($"Final: {string.Join(",", potentialTargets)}");
            return potentialTargets;
        }
    }
}
