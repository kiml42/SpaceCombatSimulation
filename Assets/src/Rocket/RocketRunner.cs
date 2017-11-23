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
        private IDetonator _detonator;
        private readonly IDeactivateableTargetPicker _targetKnower;

        /// <summary>
        /// Fuel tank for checking if it's still worth trying to fly.
        /// If null - always trys to fly like it has fuel
        /// When present and empty, doesn't bother trying to fly.
        /// </summary>
        private readonly FuelTank _tank;

        /// <summary>
        /// For debugging;
        /// </summary>
        public string name;

        public RocketRunner(IDeactivateableTargetPicker knower, IPilot engineControl, IDetonator detonator, FuelTank tank)
        {
            _pilot = engineControl;
            _detonator = detonator;
            _targetKnower = knower;
            _tank = tank;
        }

        public void RunRocket()
        {
            var targetIsValid = _targetKnower.CurrentTarget != null && _targetKnower.CurrentTarget.Transform.IsValid();
            if (targetIsValid)
            {
                if (_tank == null || _tank.HasFuel())
                {
                    //Debug.Log(name + " is flying at " + _targetKnower.CurrentTarget.Transform);
                    _pilot.Fly(_targetKnower.CurrentTarget);
                }

                if (_pilot.StartDelay <= 0)
                {
                    _detonator.AutoDetonate(_targetKnower.CurrentTarget);
                }
            }
            //else
            //{
            //    Debug.Log(name + " has no target");
            //}
            if(_tank != null && !_tank.HasFuel())
            {
                _targetKnower.Deactivate();
            }
        }
    }
}
