using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class ApproachingTargetPicker : ITargetPicker
    {
        private Rigidbody _sourceObject;
        private readonly float _weighting;

        public ApproachingTargetPicker(Rigidbody sourceObject, float weighting = 1)
        {
            _sourceObject = sourceObject;
            _weighting = weighting;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => AddScoreForDifference(t));
        }

        private PotentialTarget AddScoreForDifference(PotentialTarget target)
        {
            Vector3 targetVelocity = target.TargetRigidbody == null ? Vector3.zero : target.TargetRigidbody.velocity;

            var relativeVelocity = _sourceObject.velocity - targetVelocity;

            var reletiveLocation = target.TargetTransform.position - _sourceObject.position;

            var approachAngle = Vector3.Angle(relativeVelocity, reletiveLocation);

            var angleComponent = (-approachAngle/90)+1; //now in range +-1 with positive being good.

            angleComponent = (float)Math.Pow(angleComponent, 3); //decrease influence near 90degrees

            var score = angleComponent * relativeVelocity.magnitude * _weighting;

            target.Score += score;

            //Debug.Log("angle = " + approachAngle + ", angleComponent = " + angleComponent + ", v=" + relativeVelocity.magnitude + ", extra score=" + score + ", total score =" + target.Score);

            return target;
        }
    }
}
