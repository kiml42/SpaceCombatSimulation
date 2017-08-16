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
        private float _tanShootAngle;
        Transform _thisTurret;
        ITurretController _controller;
        private readonly Transform _aimingObject;

        public UnityFireControl(ITurretController controller, Transform thisTurret, Transform aimingObject, float tanShootAngle = _defaulShootAngle)
        {
            _thisTurret = thisTurret;
            _controller = controller;
            _tanShootAngle = tanShootAngle;
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
                var location = target.LocationInAimedSpace(_thisTurret, _aimingObject);
                if(location.z < 0)
                {
                    //turret is pointed away from target
                    return false;
                }
                var distance = location.z;
                location.z = 0;
                return location.magnitude < _tanShootAngle * distance;
            }
            return false;
        }
    }
}
