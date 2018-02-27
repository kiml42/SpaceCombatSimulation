using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public class PriorityCameraOrientator : ICameraOrientator
    {
        private List<BaseCameraOrientator> _orientators;

        public PriorityCameraOrientator(List<BaseCameraOrientator> orientators, float maxUserPriorityBonus)
        {
            _orientators = orientators;
            _userPriorityTime = maxUserPriorityBonus;
        }

        private BaseCameraOrientator _bestOrientator;
        private BaseCameraOrientator _userPriorityOrientator;

        public float _userPriorityTime;

        private float _userPriorityCountdown = 0;

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
            _userPriorityCountdown -= Time.deltaTime;

            if (Input.GetKeyUp(KeyCode.O))
            {
                CycleToNextVallidOrientator();
                Debug.Log("User selected camera mode: " + _userPriorityOrientator.Description);
            }

            var active = _orientators.Where(o => o.HasTargets);
            active = active.Any() ? active : _orientators;

            //Debug.Log(string.Join(", ", active.OrderByDescending(o => o.Priority).Select(o => o.Description + o.Priority).ToArray()));

            _bestOrientator = _userPriorityCountdown > 0
                ? _userPriorityOrientator
                : active
                .OrderByDescending(o => o.Priority)
                .FirstOrDefault();

            _bestOrientator.CalculateTargets();
            return null;
        }

        private void CycleToNextVallidOrientator()
        {
            _userPriorityCountdown = _userPriorityTime;
            if (_userPriorityOrientator == null)
            {
                _userPriorityOrientator = _orientators.Any(o => o.HasTargets) ? _orientators.First(o => o.HasTargets) : _orientators.First();
                return;
            }

            var i = _orientators.IndexOf(_userPriorityOrientator);

            for (int j = 1; j < _orientators.Count; j++)
            {
                //finds the next orientator that has targets
                var index = (i + j) % _orientators.Count;
                var orientator = _orientators.Skip(index).FirstOrDefault();
                if (orientator != null && orientator.HasTargets)
                {
                    _userPriorityOrientator = orientator;
                    return;
                }
            }
        }
    }
}
