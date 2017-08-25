using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class UnityFireControl : IFireControl
    {
        private const float _defaulShootAngle = 1f;
        private float _shootAngle;
        Transform _thisTurret;
        ITurretController _controller;
        private readonly Transform _aimingObject;

        public UnityFireControl(ITurretController controller, Transform thisTurret, Transform aimingObject, float shootAngle = _defaulShootAngle)
        {
            _thisTurret = thisTurret;
            _controller = controller;
            _shootAngle = shootAngle;
            _aimingObject = aimingObject;
        }

        public void Shoot(bool shouldShoot)
        {
            _controller.Shoot(shouldShoot);
        }

        public bool ShootIfAimed(PotentialTarget target)
        {
            var shouldShoot = ShouldShoot(target);

            Shoot(shouldShoot);

            return shouldShoot;
        }

        public bool ShouldShoot(PotentialTarget target)
        {
            //return true;
            if (target != null)
            {
                var angle = Vector3.Angle(_aimingObject.forward, target.Target.position - _aimingObject.position);
                return angle < _shootAngle;
            }
            return false;
        }
    }
}
