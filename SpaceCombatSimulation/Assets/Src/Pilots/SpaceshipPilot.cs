using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Pilots
{
    public class SpaceshipPilot : BasePilot
    {
        /// <summary>
        /// Weighting for the tangential speed correction vector, higher values will give more priority to getting the tangential speed in range
        /// </summary>
        public float TangentialSpeedWeighting = 1;

        public float MinTangentialSpeed = 0;
        public float MaxTangentialSpeed = 10;

        public float MaxRange = 100;
        public float MinRange = 20;

        public float SpeedMultiplier = 50;

        public SpaceshipPilot(ITorquerManager torqueApplier, Rigidbody pilotObject)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            RadialSpeedWeighting = 1;

            _engines = _pilotObject.GetComponentsInChildren<EngineControler>().ToList();
        }

        private bool _tangentialTooFast;
        private bool _tangentialTooSlow;

        private float MaxTanVWithHysteresis => _tangentialTooFast ? MaxTangentialSpeed : MaxTangentialSpeed * 1.1f;
        private float MinTanVWithHysteresis => _tangentialTooSlow ? MinTangentialSpeed : MinTangentialSpeed * 0.9f;

        /// <summary>
        /// Angle to turn the bow away from the target when not trying to use the main engines.
        /// </summary>
        public float BroadsideAngle { get; internal set; }

        public override void Fly(ITarget target)
        {
            RemoveNullEngines();
            if (!HasActivated())
            {
                SetPrimaryTranslationVectorOnEngines(null);  //turn off the engines
                return;
            }

            var relativeLocation = target == null
                ? -_pilotObject.position     //Return to the centre if there is no target
                : RelativeLocationInWorldSpace(target);

            var targetsVelosity = target == null
                ? -_pilotObject.velocity    //if there's no target, go to stationary target at center.
                : WorldSpaceRelativeVelocityOfTarget(target);

            Vector3 accelerationVector = getAccelerationVector(target, relativeLocation, targetsVelosity);

            Quaternion targetOrientation = GetTargetOrientation(relativeLocation, accelerationVector);

            _torqueApplier.TurnToOrientationInWorldSpace(targetOrientation, 1);

            SetVectorArrows(accelerationVector, targetOrientation * Vector3.forward, targetOrientation * Vector3.up);

            //TODO tell engines how high to set throttle based on speed error.
            SetPrimaryTranslationVectorOnEngines(accelerationVector);
        }

        private Quaternion GetTargetOrientation(Vector3 relativeLocation, Vector3 accelerationVector)
        {
            bool turnToUseMainEngines = accelerationVector.magnitude > 1;

            if (turnToUseMainEngines)
            {
                if (Log)
                {
                    Debug.Log($"Turning to use main engines - orientationVector = {accelerationVector}, UpVector: {relativeLocation}");
                }
                // The up vector of the ship should be the best vector to point to the target when pointing the bow to use the main engines.
                return Quaternion.LookRotation(accelerationVector, relativeLocation);
            }

            var offsetAttackTargetLocation = OffsetAttackTargetLocation(relativeLocation);

            if (BroadsideAngle == 0)
            {
                // the pilot should be treated as the attack orientator, and therefore pointed at the target.
                var pilotAttackOrientation = Quaternion.LookRotation(offsetAttackTargetLocation, accelerationVector);
                if (Log)
                {
                    Debug.Log($"Turning to point bow to the target - orientationForAttackOrientator = {pilotAttackOrientation}");
                }
                return pilotAttackOrientation;
            }
            // rotate the vector towards the target by the angle of the attack orientator.
            // the direction to rotate it in is the direction that turns the bow towards the bow target.
            // getting the correct side of the vessel pointing towards the enemy is handled by the pilot's up vector being the attack orientation.

            // the bow target is somewhere between the forward direction of the ship (where it's already looking)
            // and the acceleration vector (to easily use the main engines if the acceleration vector gets bigger.)
            var bowTarget = accelerationVector + _pilotObject.transform.forward;

            var perpendicular = Vector3.Cross(offsetAttackTargetLocation, bowTarget);

            var pilotTarget = Quaternion.AngleAxis(BroadsideAngle, perpendicular) * offsetAttackTargetLocation;

            return Quaternion.LookRotation(pilotTarget, offsetAttackTargetLocation);
        }

        private Vector3 OffsetAttackTargetLocation(Vector3 relativeLocation)
        {
            // TODO consider projectile speed to offset the attack orientation.
            return relativeLocation;
        }

        private Vector3 getAccelerationVector(ITarget target, Vector3 relativeLocation, Vector3 targetsVelosity)
        {
            var radialSpeedVector = CalculateRadialSpeedCorrectionVector(relativeLocation, targetsVelosity, target);

            var tangentialSpeedVector = CalculateWeightedTanSpeedVector(relativeLocation, targetsVelosity, target);

            var accelerationVector = tangentialSpeedVector + radialSpeedVector;
            if (Log)
            {
                Debug.Log($"radialSpeedVector: {radialSpeedVector}, tanSpeedVector: {tangentialSpeedVector}, accelerationVector = {accelerationVector}");
            }

            return accelerationVector;
        }

        private void SetVectorArrows(Vector3 accelerationVector, Vector3 orientationVector, Vector3 upVector)
        {
            if (OrientationVectorArrow != null)
            {
                if (orientationVector.magnitude > 0)
                {
                    OrientationVectorArrow.rotation = Quaternion.LookRotation(orientationVector, upVector);
                    OrientationVectorArrow.localScale = Vector3.one;
                }
                else
                {
                    OrientationVectorArrow.localScale = Vector3.zero;
                }
            }

            if (AccelerationVectorArrow != null)
            {
                if (accelerationVector.magnitude > 0)
                {
                    AccelerationVectorArrow.rotation = Quaternion.LookRotation(accelerationVector);
                    AccelerationVectorArrow.localScale = Vector3.one;
                }
                else
                {
                    AccelerationVectorArrow.localScale = Vector3.zero;
                }
            }
        }

        private Vector3 CalculateRadialSpeedCorrectionVector(Vector3 relativeLocation, Vector3 targetsVelosity, ITarget target)
        {
            //+ve speed = moving towards.
            var targetsApproachVelocity = targetsVelosity.ComponentParalellTo(relativeLocation);

            var isApproaching = Vector3.Angle(relativeLocation, targetsApproachVelocity) < 90;
            var approachSpeed = isApproaching
                ? -targetsApproachVelocity.magnitude
                : targetsApproachVelocity.magnitude;

            var effectiveMinRange = target != null ? MinRange : 0;

            var distanceOverMaxRange = (relativeLocation.magnitude - MaxRange) / MaxRange;
            var distanceOverMinRange = (relativeLocation.magnitude - effectiveMinRange) / MinRange;

            // TODO implement Hysteresis for the speed
            var maxDesiredSpeed = distanceOverMinRange * SpeedMultiplier;
            var minDesiredSpeed = distanceOverMaxRange * SpeedMultiplier;

            var radialSppedTooLow = approachSpeed < minDesiredSpeed;
            var radialSpeedTooHigh = approachSpeed > maxDesiredSpeed;

            if (Log)
            {
                Debug.Log(GetLogLineForRange("Distance", relativeLocation.magnitude, effectiveMinRange, MaxRange, 2)+ ", " + GetLogLineForRange("RadialSpeed", approachSpeed, minDesiredSpeed, maxDesiredSpeed, 2));
            }
            if (!radialSppedTooLow && !radialSpeedTooHigh) return Vector3.zero;

            var speedError = radialSppedTooLow
                ? (minDesiredSpeed - approachSpeed) / minDesiredSpeed
                : (maxDesiredSpeed - approachSpeed) / maxDesiredSpeed;
            speedError = Math.Abs(speedError);

            var directionVector = radialSppedTooLow
                ? relativeLocation.normalized
                : -relativeLocation.normalized;

            var weightedRadialLocationVector = directionVector * speedError * RadialSpeedWeighting;

            return weightedRadialLocationVector;
        }

        private Vector3 CalculateWeightedTanSpeedVector(Vector3 relativeLocation, Vector3 targetsVelosity, ITarget target)
        {
            var targetsTangentialVelocity = targetsVelosity.ComponentPerpendicularTo(relativeLocation);
            var tanSpeed = targetsTangentialVelocity.magnitude;
            _tangentialTooFast = tanSpeed > MaxTanVWithHysteresis;
            _tangentialTooSlow = target != null && tanSpeed < MinTanVWithHysteresis;

            if (Log)
            {
                Debug.Log(GetLogLineForRange("TanV", targetsTangentialVelocity.magnitude, MinTanVWithHysteresis, MaxTanVWithHysteresis, 2));
            }
            if (!_tangentialTooFast && !_tangentialTooSlow)
            {
                return Vector3.zero;
            }
            var VectorToGetTangentialSpeedInRange = Vector3.zero;

            if (_tangentialTooFast)
            {
                VectorToGetTangentialSpeedInRange = targetsTangentialVelocity.normalized;
            }
            else if (_tangentialTooSlow)
            {
                if (targetsTangentialVelocity.magnitude < MinTangentialSpeed * 0.2)
                {
                    //use the forward orientation of the ship because Vt is way too slow, and will yield unstable results.
                    VectorToGetTangentialSpeedInRange = (_pilotObject.transform.forward.ComponentPerpendicularTo(relativeLocation)).normalized;
                }
                else
                {
                    VectorToGetTangentialSpeedInRange = -targetsTangentialVelocity.normalized;
                }
            }

            var tanSpeedError = _tangentialTooSlow
                ? (MinTangentialSpeed - targetsTangentialVelocity.magnitude) / MinTangentialSpeed
                : _tangentialTooFast
                    ? (targetsTangentialVelocity.magnitude - MaxTangentialSpeed) / MaxTangentialSpeed
                    : 0;

            var weightedTangentialSpeedVector = VectorToGetTangentialSpeedInRange * tanSpeedError * TangentialSpeedWeighting;
            return weightedTangentialSpeedVector;
        }

        private static string GetLogLineForRange(string parameter, float actual, float min, float max, int precision)
        {
            var description = actual < min
                ? "Too Low"
                : actual > max
                    ? "Too High"
                    : "Good";

            return $"{parameter}: {min}|{Math.Round(actual, precision)}|{max} = {description}";
        }
    }
}
