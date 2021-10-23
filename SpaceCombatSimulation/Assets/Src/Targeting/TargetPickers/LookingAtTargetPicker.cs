using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    public class LookingAtTargetPicker : GeneticallyConfigurableTargetPicker
    {
        public Rigidbody AimingObject;

        [Tooltip("Fielf to use if the aiming object doesn't have a rigidbody.")]
        public Transform AimingObjectFallback;

        /// <summary>
        /// kull targets more than 90 degrees awy from looked direction
        /// </summary>
        public bool KullInvalidTargets = false;
        
        public IKnowsProjectileSpeed ProjectileSpeedKnower;

        void Start()
        {
            ProjectileSpeedKnower = ProjectileSpeedKnower ?? GetComponentInParent<IKnowsProjectileSpeed>();
        }

        public override IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
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
            var projectileSpeed = ProjectileSpeedKnower != null ? ProjectileSpeedKnower.KnownProjectileSpeed : 0;
            //TODO check this works.
            var relativeLocation = AimingObject != null
                ? target.LocationInAimedSpace(AimingObject, projectileSpeed)
                : target.LocationInOthersSpace(AimingObjectFallback, projectileSpeed);

            var angle = Vector3.Angle(relativeLocation, Vector3.forward);
            
            var newScore = Multiplier * (1 - (angle/ 180));
            newScore += angle < Threshold ? FlatBoost : 0;
            target.Score = target.Score + newScore;
            target.IsValidForCurrentPicker = angle < 90;
            return target;
        }
    }
}
