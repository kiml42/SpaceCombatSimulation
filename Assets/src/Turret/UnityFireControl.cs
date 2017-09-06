using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
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
        ITurretController _controller;
        private readonly Transform _aimingObject;

        public UnityFireControl(ITurretController controller, Transform aimingObject, float shootAngle = _defaulShootAngle)
        {
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
            if (target != null && target.TargetRigidbody.transform.IsValid() && _aimingObject.IsValid())
            {
                var angle = Vector3.Angle(_aimingObject.forward, target.TargetRigidbody.position - _aimingObject.position);
                return angle < _shootAngle;
            }
            return false;
        }
    }
}
