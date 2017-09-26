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
        private ITurretTurner _turretTurner;
        private IFireControl _fireControl;
        private readonly IKnowsCurrentTarget _knower;

        /// <summary>
        /// For debugging;
        /// </summary>
        public string name;

        public TurretRunner(IKnowsCurrentTarget knower, ITurretTurner turretTurner, IFireControl fireControl)
        {
            _turretTurner = turretTurner;
            _fireControl = fireControl;
            _knower = knower;
        }

        public void RunTurret()
        {
            if (_knower.CurrentTarget != null)
            {
                //Debug.Log(name + " is aiming at " + bestTarget.Transform);
                _turretTurner.TurnToTarget(_knower.CurrentTarget);
                _fireControl.ShootIfAimed(_knower.CurrentTarget);
            } else
            {
                _turretTurner.ReturnToRest();
                _fireControl.Shoot(false);
            }
        }
    }
}
