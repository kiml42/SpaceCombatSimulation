using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public class PriorityCameraOrientator : ICameraOrientator
    {
        private readonly List<BaseCameraOrientator> _orientators;

        public PriorityCameraOrientator(List<BaseCameraOrientator> orientators, float maxUserPriorityBonus)
        {
            _orientators = orientators;
            _userPriorityTime = maxUserPriorityBonus;
        }

        private BaseCameraOrientator _bestOrientator;
        private BaseCameraOrientator _userPriorityOrientator;

        public float _userPriorityTime;

        private float _userPriorityCountdown = 0;

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

            return _bestOrientator.CalculateTargets();
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
