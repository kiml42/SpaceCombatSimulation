using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
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

        private bool _slowdownMode;

        public SpaceshipPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<EngineControler> engines, float angleTollerance, float fuel = Mathf.Infinity)
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
                    ? -_pilotObject.velocity    //if there's no target, go to stationary target at centre.
                    : WorldSpaceReletiveVelocityOfTarget(target);
                var targetsTangentialVelocity = targetsVelosity.ComponentPerpendicularTo(reletiveLocation);

                var tanSpeed = targetsTangentialVelocity.magnitude;

                var targetsApproachVelocity = targetsVelosity.ComponentParalellTo(reletiveLocation);

                //var isApproaching = Vector3.Angle(targetsApproachVelocity, reletiveLocation) > 90;
                //var approachSpeed = isApproaching
                //    ? targetsApproachVelocity.magnitude
                //    : -targetsApproachVelocity.magnitude;

                var tangentialTooFast = tanSpeed > MaxTangentialSpeed;
                var tangentialTooSlow = tanSpeed < MinTangentialSpeed;

                var needsSlowdown = targetsApproachVelocity.magnitude > RadialSpeedThreshold;

                var happyWithSpeed = !tangentialTooFast && !tangentialTooSlow && targetsVelosity.magnitude < MaxTangentialSpeed && !needsSlowdown;
                var happyWithLocation = !isTooClose && !isTooFar;

                var completelyHappy = happyWithSpeed && happyWithLocation;

                var approachVector = CalculateWeightedApproachVector(reletiveLocation, isTooClose, isTooFar);
                var tanSpeedVector = CalculateWeightedTanSpeedVector(targetsTangentialVelocity, reletiveLocation, tangentialTooSlow, tangentialTooFast);
                var slowdownVector = CalculateWeightedSlowdownVector(targetsApproachVelocity, needsSlowdown);

                _slowdownMode = slowdownVector.magnitude > approachVector.magnitude;

                var turningVector = completelyHappy
                    ? reletiveLocation
                    : tanSpeedVector + (_slowdownMode
                        ? slowdownVector
                        : approachVector);

                //Debug.Log(
                //    "slowdownMode: " + _slowdownMode +
                //    ", distance: " + Math.Round(distance, 1) +
                //    ", approachVector: " + approachVector +
                //    ", tanSpeed: " + Math.Round(tanSpeed, 3) +
                //    ", tanSpeedVector: " + tanSpeedVector +
                //    ", VApproach: " + Math.Round(targetsApproachVelocity.magnitude, 3) +
                //    ", slowdownVector: " + slowdownVector +
                //    ", turningVector: " + turningVector);

                if (Vector3.Angle(turningVector, _pilotObject.transform.forward) > CloseEnoughAngle)
                {
                    _torqueApplier.TurnToVectorInWorldSpace(turningVector);
                }

                if (VectorArrow != null)
                {
                    if (!completelyHappy && turningVector.magnitude > 0)
                    {
                        VectorArrow.rotation = Quaternion.LookRotation(turningVector);
                        VectorArrow.localScale = Vector3.one;
                    }
                    else
                    {
                        VectorArrow.localScale = Vector3.zero;
                    }
                }

                if (completelyHappy)
                {
                    Debug.Log($"Completely happy: Pilot setting vector for engines to {null}");
                    SetFlightVectorOnEngines(null);
                }
                else
                {
                    //try firing the main engine even with no fuel to turn it off if there is no fuel.
                    Debug.Log($"Pilot setting vector for engines to turningVector: {turningVector}");
                    SetFlightVectorOnEngines(turningVector);
                }
            }
            else
            {
                Debug.Log($"Has not acivated: Pilot setting vector for engines to {null}");
                SetFlightVectorOnEngines(null);  //turn off the engine
            }
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
