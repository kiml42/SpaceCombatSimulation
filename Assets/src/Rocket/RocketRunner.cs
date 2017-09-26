using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Rocket
{
    class RocketRunner : IRocketRunner
    {
        private IPilot _pilot;
        private readonly RocketController _rocketController;
        private string _previousTarget;
        private IDetonator _detonator;
        private readonly IKnowsCurrentTarget _targetKnower;

        /// <summary>
        /// For debugging;
        /// </summary>
        public string name;

        public RocketRunner(IKnowsCurrentTarget knower, IPilot engineControl, IDetonator detonator)
        {
            _pilot = engineControl;
            _detonator = detonator;
            _targetKnower = knower;
        }

        public void RunRocket()
        {
            var targetIsValid = _targetKnower.CurrentTarget != null && _targetKnower.CurrentTarget.Transform.IsValid();
            if (targetIsValid)
            {
                //Debug.Log(name + " is flying at " + _targetKnower.CurrentTarget.Transform);
                _pilot.Fly(_targetKnower.CurrentTarget);

                if (_pilot.StartDelay <= 0)
                {
                    _detonator.AutoDetonate(_targetKnower.CurrentTarget);
                }
            }
            //else
            //{
            //    Debug.Log(name + " has no target");
            //}
        }
    }
}
