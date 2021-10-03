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
        /// Weighting for the slowdown vector - higher means the ship lwill start slowing down sooner
        /// 0 means slowdown is never used.
        /// </summary>
        public float SlowdownWeighting = 1;

        /// <summary>
        /// Speed beneath which the ship doesn't bother trying to slow down.
        /// </summary>
        public float RadialSpeedThreshold = 1;

        /// <summary>
        /// Weightning for the tangential speed correction vector, heigher values will give more priority to getting the tangential speed in range
        /// </summary>
        public float TangentialSpeedWeighting = 1;

        public float MinTangentialSpeed = 0;
        public float MaxTangentialSpeed = 10;

        public float MaxRange = 100;
        public float MinRange = 20;

        /// <summary>
        /// Remembered from the previous iteration for hysteresis.
        /// </summary>
        private bool _slowdownMode;

        public SpaceshipPilot(ITorquerManager torqueApplier, Rigidbody pilotObject, List<EngineControler> engines)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            SlowdownWeighting = 10;
            AccelerateTowardsTargetWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        private bool _isTooFar;
        private bool _isTooClose;
        private bool _tangentialTooFast;
        private bool _tangentialTooSlow;

        private float MaxRangeWithHysteresis => _isTooFar ? MaxRange : MaxRange * 1.1f;
        private float MinRangeWithHysteresis => _isTooClose ? MinRange : MinRange * 0.9f;

        private float MaxTanVWithHysteresis => _tangentialTooFast ? MaxTangentialSpeed : MaxTangentialSpeed * 1.1f;
        private float MinTanVWithHysteresis => _tangentialTooSlow ? MinTangentialSpeed : MinTangentialSpeed * 0.9f;

        public override void Fly(ITarget target)
        {
            RemoveNullEngines();
            if (HasActivated())
            {
                var reletiveLocation = target == null
                    ? -_pilotObject.position     //Return to the centre if there is no target
                    : ReletiveLocationInWorldSpace(target);

                var targetsVelosity = target == null
                    ? -_pilotObject.velocity    //if there's no target, go to stationary target at center.
                    : WorldSpaceReletiveVelocityOfTarget(target);

                //TODO work out the desired radial speed from distance and set the acceleration vector accordingly.
                var distance = reletiveLocation.magnitude;
                var targetsApproachVelocity = targetsVelosity.ComponentParalellTo(reletiveLocation);
                _isTooFar = distance > MaxRangeWithHysteresis;
                _isTooClose = distance < MinRangeWithHysteresis;
                var approachVector = CalculateWeightedApproachVector(reletiveLocation);
                var slowdownVector = CalculateWeightedSlowdownVector(targetsApproachVelocity);

                var targetsTangentialVelocity = targetsVelosity.ComponentPerpendicularTo(reletiveLocation);
                var tanSpeed = targetsTangentialVelocity.magnitude;
                _tangentialTooFast = tanSpeed > MaxTanVWithHysteresis;
                _tangentialTooSlow = target != null && tanSpeed < MinTanVWithHysteresis;
                var tanSpeedVector = CalculateWeightedTanSpeedVector(targetsTangentialVelocity, reletiveLocation, _tangentialTooSlow, _tangentialTooFast);

                _slowdownMode = slowdownVector.magnitude > 0 && slowdownVector.magnitude > approachVector.magnitude;

                var accelerationVector = tanSpeedVector + slowdownVector + approachVector;

                var orientationVector = (accelerationVector.magnitude > 10)
                    ? reletiveLocation
                    : accelerationVector;

                if (Log)
                {
                    Debug.Log($"targetsApproachVelocity: {targetsApproachVelocity}");
                    Debug.Log($"approachVector: {approachVector}, tanSpeedVector: {tanSpeedVector}, slowdownVector: {slowdownVector}");
                }


                var upVector = GetUpVector();

                if (Vector3.Angle(orientationVector, _pilotObject.transform.forward) > CloseEnoughAngle)
                {
                    _torqueApplier.TurnToVectorInWorldSpace(orientationVector, upVector);
                }
                EmitLog(distance, tanSpeed, targetsApproachVelocity, accelerationVector, orientationVector);
                // TODO use torquer to orient if the up or the look rotations are too far off.
                // TODO calculate the up rotation from a known direction to try to point to the target.

                SetVectorArrows(accelerationVector, orientationVector, upVector);

                //TODO work out the torque axis and pass it to the engines.
                //SetTurningVectorOnEngines(orientationVector, upVector);

                //TODO tell engines how high to set throttle based on speed error.
                SetPrimaryTranslationVectorOnEngines(accelerationVector);
            }
            else
            {
                SetFlightVectorOnEngines(null);  //turn off the engine
            }
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

        private void EmitLog(float distance, float tanSpeed, Vector3 targetsApproachVelocity, Vector3 accelerationVector, Vector3 orientationVector)
        {
            if (Log)
            {
                var log = new StringBuilder();
                log.Append(GetLogLineForRange("Distance", distance, MinRangeWithHysteresis, MaxRangeWithHysteresis, 1));
                log.AppendLine(", " + GetLogLineForRange("TanV", tanSpeed, MinTanVWithHysteresis, MaxTanVWithHysteresis, 3));
                log.AppendLine($"_slowdownMode={_slowdownMode}, radialSpeed={Math.Round(targetsApproachVelocity.magnitude, 3)}, accelerationVector = {accelerationVector}, orientationVector = {orientationVector}");
                Debug.Log(log);
            }
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

        private Vector3 CalculateWeightedApproachVector(Vector3 reletiveLocation)
        {
            if (!_isTooClose && !_isTooFar) return Vector3.zero;

            // Distance over MaxRange, normalised to Max Range
            var maxRangeError = (reletiveLocation.magnitude - MaxRange) / MaxRange;
            // Distance under MinRange, normalised to Min Range
            var minRangeError = (MinRange - reletiveLocation.magnitude) / MinRange;

            var locationError = _isTooClose
                ? minRangeError
                : maxRangeError;

            var vectorToCorrectRadialSpeed = _isTooClose
                ? -reletiveLocation.normalized
                : reletiveLocation.normalized;

            var weightedRadialLocationVector = vectorToCorrectRadialSpeed * locationError * AccelerateTowardsTargetWeighting;
            return weightedRadialLocationVector;
        }

        private Vector3 CalculateWeightedTanSpeedVector(Vector3 targetsTangentialVelocity, Vector3 reletiveLocationOfTarget, bool tangentialTooSlow, bool tangentialTooFast)
        {
            if (!tangentialTooFast && !tangentialTooSlow)
            {
                return Vector3.zero;
            }
            var VectorToGetTangentialSpeedInRange = Vector3.zero;

            if (tangentialTooFast)
            {
                VectorToGetTangentialSpeedInRange = targetsTangentialVelocity.normalized;
            }
            else if (tangentialTooSlow)
            {
                if (targetsTangentialVelocity.magnitude < MinTangentialSpeed * 0.2)
                {
                    //use the forward orientation of the ship because Vt is way too slow, and will yield unstable results.
                    VectorToGetTangentialSpeedInRange = (_pilotObject.transform.forward.ComponentPerpendicularTo(reletiveLocationOfTarget)).normalized;
                }
                else
                {
                    VectorToGetTangentialSpeedInRange = -targetsTangentialVelocity.normalized;
                }
            }

            var tanSpeedError = tangentialTooSlow
                ? (MinTangentialSpeed - targetsTangentialVelocity.magnitude) / MinTangentialSpeed
                : tangentialTooFast
                    ? (targetsTangentialVelocity.magnitude - MaxTangentialSpeed) / MaxTangentialSpeed
                    : 0;

            var weightedTangentialSpeedVector = VectorToGetTangentialSpeedInRange * tanSpeedError * TangentialSpeedWeighting;
            return weightedTangentialSpeedVector;
        }

        private Vector3 CalculateWeightedSlowdownVector(Vector3 targetsApproachVelocity)
        {
            var tangentialSpeed = targetsApproachVelocity.magnitude;
            var RadialSpeedIsTooFast = tangentialSpeed > RadialSpeedThreshold;
            if (!RadialSpeedIsTooFast)
            {
                return Vector3.zero;
            }
            var speedWeighting = (tangentialSpeed - RadialSpeedThreshold) / RadialSpeedThreshold;
            var weightedSlowdownVector = targetsApproachVelocity.normalized * speedWeighting * SlowdownWeighting;
            //if (_slowdownMode)
            //{
            //    //10% extra weight when in slowdown mode, to prevent flip-flopping
            //    weightedSlowdownVector *= 1.1f;
            //}
            return weightedSlowdownVector;
        }
    }
}
