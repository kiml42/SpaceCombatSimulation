using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.src.Pilots
{
    public class SpaceshipPilot : BasePilot
    {
        public float SlowdownWeighting = 1;
        public float TangentialSpeedWeighting = 1;

        public float MinTangentialVelocity = 0;
        public float MaxTangentialVelocity = 10;

        public float MaxRange = 100;
        public float MinRange = 20;

        public SpaceshipPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<Transform> engines, float angleTollerance, float fuel = Mathf.Infinity)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            AngleTollerance = angleTollerance;
            RemainingFuel = fuel;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        public override void Fly(PotentialTarget target)
        {
            RemoveNullEngines();
            if (ShouldTurn())
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

                var tangentialTooFast = tanSpeed > MaxTangentialVelocity;
                var tangentialTooSlow = tanSpeed < MinTangentialVelocity;
                
                var happyWithSpeed = !tangentialTooFast && !tangentialTooSlow && targetsVelosity.magnitude < MaxTangentialVelocity;
                var happyWithLocation = !isTooClose && !isTooFar;

                var completelyHappy = happyWithSpeed && happyWithLocation;

                var approachVector = CalculateWeightedApproachVector(reletiveLocation, isTooClose, isTooFar);
                var tanSpeedVector = CalculateWeightedTanSpeedVector(targetsTangentialVelocity, tangentialTooSlow, tangentialTooFast);
                var slowdownVector = CalculateWeightedSlowdownVector(targetsApproachVelocity);

                var turningVector = completelyHappy
                    ? reletiveLocation
                    : approachVector + tanSpeedVector + slowdownVector;

                //Debug.Log(
                //    "approachVector: " + approachVector +
                //    ", tanSpeedVector: " + tanSpeedVector +
                //    ", slowdownVector: " + slowdownVector +
                //    ", reletiveLocation: " + reletiveLocation +
                //    ", turningVector: " + turningVector);

                _torqueApplier.TurnToVectorInWorldSpace(turningVector);

                if (VectorArrow != null)
                {
                    VectorArrow.rotation = Quaternion.LookRotation(turningVector);
                    //VectorArrow.localScale = Vector3.one * turningVector.magnitude;
                }

                //try firing the main engine even with no fuel to turn it off if there is no fuel.
                SetEngineActivationState(IsAimedAtWorldVector(turningVector) && !completelyHappy);
            }
            else
            {
                SetEngineActivationState(false);  //turn off the engine
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

        private Vector3 CalculateWeightedTanSpeedVector(Vector3 targetsTangentialVelocity, bool tangentialTooSlow, bool tangentialTooFast)
        {
            var correctTangentialSpeedVector = tangentialTooFast
                ? targetsTangentialVelocity.normalized
                : tangentialTooSlow
                    ? -targetsTangentialVelocity.normalized
                    : Vector3.zero;

            var tanSpeedError = tangentialTooSlow
                ? MinTangentialVelocity - targetsTangentialVelocity.magnitude
                : tangentialTooFast
                    ? targetsTangentialVelocity.magnitude - MaxTangentialVelocity
                    : 0;

            var weightedTangentialSpeedVector = correctTangentialSpeedVector * tanSpeedError * TangentialSpeedWeighting;
            return weightedTangentialSpeedVector;
        }

        private Vector3 CalculateWeightedSlowdownVector(Vector3 targetsApproachVelocity)
        {
            var weightedSlowdownVector = targetsApproachVelocity * SlowdownWeighting;
            return weightedSlowdownVector;
        }
    }
}
