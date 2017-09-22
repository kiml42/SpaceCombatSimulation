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
        //public int DetonateWithLessThanXRemainingFuel = -100;
        private ITargetDetector _targetDetector;
        private ITargetPicker _targetPicker;
        private IPilot _pilot;
        private readonly RocketController _rocketController;
        private string _previousTarget;
        private IDetonator _detonator;
        private readonly IKnowsCurrentTarget _targetKnower;

        /// <summary>
        /// For debugging;
        /// </summary>
        public string name;
        public bool ContinuallyCheckForTargets = false;
        public bool NeverRetarget = false;
        private bool _hasHadTarget = false;

        public RocketRunner(ITargetDetector targetDetector, ITargetPicker targetPicker, IPilot engineControl, IDetonator detonator, IKnowsCurrentTarget knower)
        {
            _targetDetector = targetDetector;
            _targetPicker = targetPicker;
            _pilot = engineControl;
            _detonator = detonator;
            _targetKnower = knower;
        }

        public void RunRocket()
        {
            if(!NeverRetarget || !_hasHadTarget)
            {
                var targetIsInvalid = _targetKnower.CurrentTarget == null || _targetKnower.CurrentTarget.TargetTransform.IsInvalid();

                if (ContinuallyCheckForTargets || targetIsInvalid)
                {
                    //Debug.Log(name + " aquiring new target");
                    var allTargets = _targetDetector.DetectTargets();
                    var bestTarget = _targetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score).FirstOrDefault();
                    _targetKnower.CurrentTarget = bestTarget;
                    if(bestTarget != null)
                    {
                        _hasHadTarget = true;
                    }
                }
            }

            var targetIsValid = _targetKnower.CurrentTarget != null && _targetKnower.CurrentTarget.TargetTransform.IsValid();
            if (targetIsValid)
            {
                //Debug.Log(name + " is flying at " + _targetKnower.CurrentTarget.TargetTransform);
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
