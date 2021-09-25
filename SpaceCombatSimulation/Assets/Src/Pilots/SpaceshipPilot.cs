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

        public SpaceshipPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<EngineControler> engines)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        public override void Fly(ITarget target)
        {
            RemoveNullEngines();
            if (HasActivated())
            {
                var reletiveLocation = target == null
                    ? -_pilotObject.position     //Return to the centre if there is no target
                    : ReletiveLocationInWorldSpace(target);

                var distance = reletiveLocation.magnitude;

                var isTooFar = distance > MaxRange;
                var isTooClose = distance < MinRange;


                var targetsVelosity = target == null
                    ? -_pilotObject.velocity    //if there's no target, go to stationary target at center.
                    : WorldSpaceReletiveVelocityOfTarget(target);
                var targetsTangentialVelocity = targetsVelosity.ComponentPerpendicularTo(reletiveLocation);

                var tanSpeed = targetsTangentialVelocity.magnitude;

                var targetsApproachVelocity = targetsVelosity.ComponentParalellTo(reletiveLocation);

                var tangentialTooFast = tanSpeed > MaxTangentialSpeed;
                var tangentialTooSlow = tanSpeed < MinTangentialSpeed;


                var isGoingTooFast = targetsApproachVelocity.magnitude > RadialSpeedThreshold;

                var happyWithSpeed = !tangentialTooFast && !tangentialTooSlow && targetsVelosity.magnitude < MaxTangentialSpeed && !isGoingTooFast;
                var happyWithLocation = !isTooClose && !isTooFar;

                var happyWithSpeedAndLocation = happyWithSpeed && happyWithLocation;

                var approachVector = CalculateWeightedApproachVector(reletiveLocation, isTooClose, isTooFar);
                var tanSpeedVector = CalculateWeightedTanSpeedVector(targetsTangentialVelocity, reletiveLocation, tangentialTooSlow, tangentialTooFast);
                var slowdownVector = CalculateWeightedSlowdownVector(targetsApproachVelocity, isGoingTooFast);
                _slowdownMode = slowdownVector.magnitude > approachVector.magnitude;

                var accelerationVector = tanSpeedVector + (_slowdownMode
                        ? slowdownVector
                        : approachVector);

                var orientationVector = happyWithSpeedAndLocation
                    ? reletiveLocation
                    : accelerationVector;

                EmitLog(distance, tanSpeed, targetsApproachVelocity, accelerationVector, orientationVector);

                var upVector = GetUpVector();

                if (Vector3.Angle(orientationVector, _pilotObject.transform.forward) > CloseEnoughAngle)
                {
                    _torqueApplier.TurnToVectorInWorldSpace(orientationVector, upVector);
                }
                // TODO use torquer to orient if the up or the look rotations are too far off.
                // TODO calculate the up rotation from a known direction to try to point to the target.

                if (VectorArrow != null)
                {
                    if (!happyWithSpeedAndLocation && orientationVector.magnitude > 0)
                    {
                        VectorArrow.rotation = Quaternion.LookRotation(orientationVector, upVector);
                        VectorArrow.localScale = Vector3.one;
                    }
                    else
                    {
                        VectorArrow.localScale = Vector3.zero;
                    }
                }

                if (happyWithSpeedAndLocation)
                {
                    SetTurningVectorOnEngines(null, upVector);
                    SetPrimaryTranslationVectorOnEngines(accelerationVector);
                }
                else
                {
                    SetFlightVectorOnEngines(orientationVector, upVector);
                }
            }
            else
            {
                SetFlightVectorOnEngines(null);  //turn off the engine
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
                log.Append(GetLogLineForRange("Distance", distance, MinRange, MaxRange, 1));
                log.AppendLine(", " + GetLogLineForRange("TanV", tanSpeed, MinTangentialSpeed, MaxTangentialSpeed, 3));
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

        private Vector3 CalculateWeightedApproachVector(Vector3 reletiveLocation, bool isTooClose, bool isTooFar)
        {
            var locationError = isTooClose
                ? MinRange - reletiveLocation.magnitude
                : isTooFar
                    ? reletiveLocation.magnitude - MaxRange
                    : 0;

            var correvctRadialLocationVector = isTooFar
                ? reletiveLocation.normalized
                : isTooClose
                    ? -reletiveLocation.normalized
                    : Vector3.zero;

            var weightedRadialLocationVector = correvctRadialLocationVector * locationError * LocationAimWeighting;
            return weightedRadialLocationVector;
        }

        private Vector3 CalculateWeightedTanSpeedVector(Vector3 targetsTangentialVelocity, Vector3 reletiveLocationOfTarget, bool tangentialTooSlow, bool tangentialTooFast)
        {
            var correctTangentialSpeedVector = Vector3.zero;

            if (tangentialTooFast)
            {
                correctTangentialSpeedVector = targetsTangentialVelocity.normalized;
            }
            else if (tangentialTooSlow)
            {
                if (targetsTangentialVelocity.magnitude < MinTangentialSpeed * 0.1)
                {
                    //use the forward orientation of the ship because Vt is way too slow, and wil yield unstable results.
                    correctTangentialSpeedVector = (_pilotObject.transform.forward.ComponentPerpendicularTo(reletiveLocationOfTarget)).normalized;
                }
                else
                {
                    correctTangentialSpeedVector = -targetsTangentialVelocity.normalized;
                }
            }

            var tanSpeedError = tangentialTooSlow
                ? MinTangentialSpeed - targetsTangentialVelocity.magnitude
                : tangentialTooFast
                    ? targetsTangentialVelocity.magnitude - MaxTangentialSpeed
                    : 0;

            var weightedTangentialSpeedVector = correctTangentialSpeedVector * tanSpeedError * TangentialSpeedWeighting;
            return weightedTangentialSpeedVector;
        }

        private Vector3 CalculateWeightedSlowdownVector(Vector3 targetsApproachVelocity, bool needsSlowdown)
        {
            if (!needsSlowdown)
            {
                return Vector3.zero;
            }
            var weightedSlowdownVector = targetsApproachVelocity * SlowdownWeighting;
            if (_slowdownMode)
            {
                //10% extra weight when in slowdown mode, to prevent flip-flopping
                weightedSlowdownVector *= 1.1f;
            }
            return weightedSlowdownVector;
        }
    }
}
