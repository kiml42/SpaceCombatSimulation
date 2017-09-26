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
        public float Multiplier = 100;

        /// <summary>
        /// kull targets more than 90 degrees awy from looked direction
        /// </summary>
        public bool KullInvalidTargets = false;

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
            potentialTargets = potentialTargets.Select(t => AddScoreForAngle(t));

            if (KullInvalidTargets && potentialTargets.Any(t => t.IsValidForCurrentPicker))
            {
                return potentialTargets.Where(t => t.IsValidForCurrentPicker);
            }
            return potentialTargets;
        }

        private PotentialTarget AddScoreForAngle(PotentialTarget target)
        {
            var reletiveLocation = target.LocationInAimedSpace(_aimingObject, ProjectileSpeed);
            var distanceInFront = reletiveLocation.z;
            reletiveLocation.z = 0;
            var distanceToSide = reletiveLocation.magnitude;

            var angle = Vector3.Angle(reletiveLocation, Vector3.forward);
            
            var newScore = Multiplier * (1 - (angle/ 180));
            target.Score = target.Score + newScore;
            target.IsValidForCurrentPicker = angle < 90;
            return target;
        }
    }
}
