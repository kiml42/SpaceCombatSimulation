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
        private Transform _sourceObject;
        private Transform _aimingObject;

        public LookingAtTargetPicker(Transform sourceObject, Transform aimingObject)
        {
            _sourceObject = sourceObject;
            _aimingObject = aimingObject;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => AddScoreForAngle(t));
        }

        private PotentialTarget AddScoreForAngle(PotentialTarget target)
        {
            var reletiveLocation = target.LocationInAimedSpace(_sourceObject.transform, _aimingObject);
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
