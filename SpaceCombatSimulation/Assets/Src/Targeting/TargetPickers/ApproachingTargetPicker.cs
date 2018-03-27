using Assets.Src.Evolution;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    public class ApproachingTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public Rigidbody SourceObject;
        
        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => AddScoreForDifference(t));
        }

        private PotentialTarget AddScoreForDifference(PotentialTarget target)
        {
            Vector3 targetVelocity = target.Rigidbody == null ? Vector3.zero : target.Rigidbody.velocity;

            var relativeVelocity = SourceObject.velocity - targetVelocity;

            var reletiveLocation = target.Transform.position - SourceObject.position;

            var approachAngle = Vector3.Angle(relativeVelocity, reletiveLocation);

            var angleComponent = (-approachAngle/90)+1; //now in range +-1 with positive being good.

            angleComponent = (float)Math.Pow(angleComponent, 3); //decrease influence near 90degrees

            var score = angleComponent * relativeVelocity.magnitude * Multiplier;

            target.Score += score;

            //Debug.Log("angle = " + approachAngle + ", angleComponent = " + angleComponent + ", v=" + relativeVelocity.magnitude + ", extra score=" + score + ", total score =" + target.Score);

            return target;
        }
    }
}
