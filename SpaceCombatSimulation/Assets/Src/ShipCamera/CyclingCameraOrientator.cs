using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public class CyclingCameraOrientator : ICameraOrientator
    {
        private readonly List<BaseCameraOrientator> _orientators;

        public CyclingCameraOrientator(List<BaseCameraOrientator> orientators, float cyclePeriod )
        {
            _orientators = orientators;
            _cyclePeriod = cyclePeriod;
        }

        private readonly float _cyclePeriod;
        private float _cycleTimer = 0;

        private BaseCameraOrientator _bestOrientator;
        
        public bool HasTargets { get { return _orientators.Any(o => o.HasTargets); } }

        public ShipCamTargetValues CalculateTargets()
        {
            if(HasTargets && ((_cyclePeriod > 0 && _cycleTimer > _cyclePeriod) || Input.GetKeyUp(KeyCode.O) || _bestOrientator == null || !_bestOrientator.HasTargets))
            {
                CycleToNextVallidOrientator();
                _cycleTimer = 0;
            }

            _cycleTimer += Time.unscaledDeltaTime;
            return _bestOrientator.CalculateTargets();
        }

        private void CycleToNextVallidOrientator()
        {
            if(_bestOrientator == null)
            {
                _bestOrientator = _orientators.Any(o => o.HasTargets) ? _orientators.First(o => o.HasTargets) : _orientators.First();
                return;
            }

            var i = _orientators.IndexOf(_bestOrientator);
            
            for(int j = 1; j < _orientators.Count; j++)
            {
                //finds the next orientator that has targets
                var index = (i + j) % _orientators.Count;
                var orientator = _orientators.Skip(index).FirstOrDefault();
                if(orientator != null && orientator.HasTargets)
                {
                    _bestOrientator = orientator;
                    return;
                }
            }
        }
    }
}
