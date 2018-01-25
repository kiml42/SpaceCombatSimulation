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
        private readonly IKnowsCurrentTarget _knower;

        public TurretRunner(IKnowsCurrentTarget knower, ITurretTurner turretTurner)
        {
            _turretTurner = turretTurner;
            _knower = knower;
        }

        public void RunTurret()
        {
            if (_knower.CurrentTarget != null)
            {
                _turretTurner.TurnToTarget(_knower.CurrentTarget);
            } else
            {
                _turretTurner.ReturnToRest();
            }
        }
    }
}
