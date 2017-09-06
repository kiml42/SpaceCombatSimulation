using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class LookingAtTargetPicker : ITargetPicker
    {
        private Rigidbody _aimingObject;

        /// <summary>
        /// used for velocity correction.
        /// Set to null to not correct for velocity (default)
        /// </summary>
        public float? ProjectileSpeed;

        public LookingAtTargetPicker(Rigidbody aimingObject)
        {
            _aimingObject = aimingObject;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => AddScoreForAngle(t));
        }

        private PotentialTarget AddScoreForAngle(PotentialTarget target)
        {
            var reletiveLocation = target.LocationInAimedSpace(_aimingObject, ProjectileSpeed);
            var distanceInFront = reletiveLocation.z;
            reletiveLocation.z = 0;
            var distanceToSide = reletiveLocation.magnitude;

            var angle = Math.Atan2(distanceToSide, distanceInFront);
            
            var newScore = 100 * (1 - (Math.Abs(angle)/ Math.PI));
            target.Score = target.Score + (float) newScore;
            return target;
        }
    }
}
