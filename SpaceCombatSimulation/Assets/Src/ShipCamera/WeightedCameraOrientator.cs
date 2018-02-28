using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public class WeightedCameraOrientator : ICameraOrientator
    {
        private List<BaseCameraOrientator> _orientators;
        private IEnumerable<BaseCameraOrientator> _active = new List<BaseCameraOrientator>();

        public WeightedCameraOrientator(List<BaseCameraOrientator> orientators)
        {
            _orientators = orientators;
        }

        public bool HasTargets { get { return _orientators.Any(o => o.HasTargets && o.Priority > 0); } }

        private float _totalWeight {
            get
            {
                return _active.Sum(o => o.Priority);
            }
        }

        public ShipCamTargetValues CalculateTargets()
        {
            _active = _orientators.Where(o => o.HasTargets && o.Priority > 0);

            //Debug.Log(string.Join(", ", _active.OrderByDescending(o => o.Priority).Select(o => o.Description + o.Priority).ToArray()));
            
            var weightedValues = _active.Select(o => o.CalculateTargets().MultiplyBy(o.Priority));
            var sum = ShipCamTargetValues.Zero;

            foreach(var v in weightedValues)
            {
                sum = sum.AddTo(v);
            }

            return sum.DivideBy(_totalWeight);
        }
    }
}
