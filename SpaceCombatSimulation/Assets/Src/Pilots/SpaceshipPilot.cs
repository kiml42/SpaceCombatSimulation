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
        /// Weightning for the tangential speed correction vector, heigher values will give more priority to getting the tangential speed in range
        /// </summary>
        public float TangentialSpeedWeighting = 1;

        public float MinTangentialSpeed = 0;
        public float MaxTangentialSpeed = 10;

        public float MaxRange = 100;
        public float MinRange = 20;

        public float SpeedMultiplier = 50;

        public SpaceshipPilot(ITorquerManager torqueApplier, Rigidbody pilotObject, List<EngineControler> engines)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            RadialSpeedWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        private bool _tangentialTooFast;
        private bool _tangentialTooSlow;

        private float MaxTanVWithHysteresis => _tangentialTooFast ? MaxTangentialSpeed : MaxTangentialSpeed * 1.1f;
        private float MinTanVWithHysteresis => _tangentialTooSlow ? MinTangentialSpeed : MinTangentialSpeed * 0.9f;

        public override void Fly(ITarget target)
        {
            RemoveNullEngines();
            if (!HasActivated())
            {
                SetFlightVectorOnEngines(null);  //turn off the engines
                return;
            }

            var reletiveLocation = target == null
                ? -_pilotObject.position     //Return to the centre if there is no target
                : ReletiveLocationInWorldSpace(target);

            var targetsVelosity = target == null
                ? -_pilotObject.velocity    //if there's no target, go to stationary target at center.
                : WorldSpaceReletiveVelocityOfTarget(target);

            Vector3 accelerationVector = getAccelerationVector(target, reletiveLocation, targetsVelosity);

            bool turnToUseMainEngines = accelerationVector.magnitude > 1;
            var orientationVector = turnToUseMainEngines
                ? accelerationVector
                : reletiveLocation;

            var upVector = GetUpVector();

            if (Vector3.Angle(orientationVector, _pilotObject.transform.forward) > CloseEnoughAngle)
            {
                _torqueApplier.TurnToVectorInWorldSpace(orientationVector, upVector);
            }

            if (Log)
            {
                Debug.Log($"turnToUseMainEngines = {turnToUseMainEngines}, orientationVector = {orientationVector}");
            }
            // TODO use torquer to orient if the up or the look rotations are too far off.
            // TODO calculate the up rotation from a known direction to try to point to the target.

            SetVectorArrows(accelerationVector, orientationVector, upVector);

            //TODO work out the torque axis and pass it to the engines.
            //SetTurningVectorOnEngines(orientationVector, upVector);

            //TODO tell engines how high to set throttle based on speed error.
            SetPrimaryTranslationVectorOnEngines(accelerationVector);
        }

        private Vector3 getAccelerationVector(ITarget target, Vector3 reletiveLocation, Vector3 targetsVelosity)
        {
            var radialSpeedVector = CalculateRadialSpeedCorrectionVector(reletiveLocation, targetsVelosity, target);

            var tangentialSpeedVector = CalculateWeightedTanSpeedVector(reletiveLocation, targetsVelosity, target);

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

        private Vector3 GetUpVector()
        {
            return Vector3.up; // ToDo set up to get the correct side of the ship pointing in the right direction.
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

        private Vector3 CalculateWeightedTanSpeedVector(Vector3 reletiveLocation, Vector3 targetsVelosity, ITarget target)
        {
            var targetsTangentialVelocity = targetsVelosity.ComponentPerpendicularTo(reletiveLocation);
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
                    VectorToGetTangentialSpeedInRange = (_pilotObject.transform.forward.ComponentPerpendicularTo(reletiveLocation)).normalized;
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
