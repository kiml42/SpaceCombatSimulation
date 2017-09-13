using Assets.src.interfaces;
using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class TurretRunner : ITurretRunner
    {
        private ITargetDetector _targetDetector;
        private ITargetPicker _targetPicker;
        private ITurretTurner _turretTurner;
        private IFireControl _fireControl;
        private readonly IKnowsCurrentTarget _knower;

        /// <summary>
        /// For debugging;
        /// </summary>
        public string name;

        public TurretRunner(ITargetDetector targetDetector, ITargetPicker targetPicker, ITurretTurner turretTurner, IFireControl fireControl, IKnowsCurrentTarget knower)
        {
            _targetDetector = targetDetector;
            _targetPicker = targetPicker;
            _turretTurner = turretTurner;
            _fireControl = fireControl;
            _knower = knower;
        }

        public void RunTurret()
        {
            var allTargets = _targetDetector.DetectTargets();
            var bestTarget = _targetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score).FirstOrDefault();

            if (_knower != null)
            {
                _knower.CurrentTarget = bestTarget;
            }

            if (bestTarget != null)
            {
                //Debug.Log(name + " is aiming at " + bestTarget.TargetTransform);
                _turretTurner.TurnToTarget(bestTarget);
                _fireControl.ShootIfAimed(bestTarget);
            } else
            {
                _turretTurner.ReturnToRest();
                _fireControl.Shoot(false);
            }
        }
    }
}
