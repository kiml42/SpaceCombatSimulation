using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public class CyclingCameraOrientator : ICameraOrientator
    {
        private List<BaseCameraOrientator> _orientators;

        public CyclingCameraOrientator(List<BaseCameraOrientator> orientators, float cyclePeriod )
        {
            _orientators = orientators;
            _cyclePeriod = cyclePeriod;
        }

        private float _cyclePeriod;
        private float _cycleTimer = 0;

        private BaseCameraOrientator _bestOrientator;

        public Vector3 ReferenceVelocity { get { return _bestOrientator.ReferenceVelocity; } }

        public Vector3 ParentLocationTarget { get { return _bestOrientator.ParentLocationTarget; } }

        public Vector3 CameraLocationTarget { get { return _bestOrientator.CameraLocationTarget; } }

        public Quaternion ParentOrientationTarget { get { return _bestOrientator.ParentOrientationTarget; } }

        public Quaternion CameraOrientationTarget { get { return _bestOrientator.CameraOrientationTarget; } }

        public Vector3 ParentPollTarget { get { return _bestOrientator.ParentPollTarget; } }

        public Vector3 CameraPollTarget { get { return _bestOrientator.CameraPollTarget; } }

        public float CameraFieldOfView { get { return _bestOrientator.CameraFieldOfView; } }

        public bool HasTargets { get { return _orientators.Any(o => o.HasTargets); } }

        public ShipCamTargetValues CalculateTargets()
        {
            if(HasTargets && ((_cyclePeriod > 0 && _cycleTimer > _cyclePeriod) || Input.GetKeyUp(KeyCode.O) || _bestOrientator == null || !_bestOrientator.HasTargets))
            {
                CycleToNextVallidOrientator();
                _cycleTimer = 0;
            }

            _cycleTimer += Time.deltaTime;
            _bestOrientator.CalculateTargets();
            return null;
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
