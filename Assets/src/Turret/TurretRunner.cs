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

        public TurretRunner(ITargetDetector targetDetector, ITargetPicker targetPicker, ITurretTurner turretTurner, IFireControl fireControl)
        {
            _targetDetector = targetDetector;
            _targetPicker = targetPicker;
            _turretTurner = turretTurner;
            _fireControl = fireControl;
        }

        public void RunTurret()
        {
            var allTargets = _targetDetector.DetectTargets();
            var bestTarget = _targetPicker.FilterTargets(allTargets).OrderByDescending(t => t.Score).FirstOrDefault();

            if(bestTarget != null)
            {
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
