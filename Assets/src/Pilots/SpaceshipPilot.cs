using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.src.Pilots
{
    public class SpaceshipPilot : BasePilot
    {
        public float SlowdownWeighting { get; set; }

        public SpaceshipPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, Transform engine, float shootAngle, float fuel = Mathf.Infinity, int startDelay = 0)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            AddEngine(engine);
        }

        public SpaceshipPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<Transform> engines, float shootAngle, float fuel = Mathf.Infinity, int startDelay = 0)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        public SpaceshipPilot(ITorqueApplier torqueApplier, Rigidbody pilotAndEngine, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotAndEngine;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            AddEngine(pilotAndEngine.transform);
        }

        public void AddEngine(Transform engine)
        {
            _engines.Add(engine);
        }


        public float ApproachVelocity = 0;
        public float LocationTollerance = 20;
        public float VelociyTollerance = 1;

        public override void Fly(PotentialTarget target)
        {
            RemoveNullEngines();
            if (ShouldTurn())
            {
                var reletiveLocation = VectorTowardsTargetInWorldSpace(target);
                var needsToMoveToTarget = reletiveLocation.magnitude > LocationTollerance;

                var moveTowardsTargetVector = needsToMoveToTarget ? reletiveLocation : Vector3.zero;

                var targetsVelosity = WorldSpaceReletiveVelocityOfTarget(target);
                var targetsSpeed = targetsVelosity.magnitude;
                var needsSlowdown = targetsSpeed > (ApproachVelocity + VelociyTollerance);
                var slowdownVecor = needsSlowdown ? targetsVelosity : Vector3.zero;

                var closeEnough = !needsToMoveToTarget && !needsSlowdown;

                var turningVector = closeEnough
                    ? reletiveLocation
                    : (SlowdownWeighting * slowdownVecor) + VectorToCancelLateralVelocityInWorldSpace(target) + (moveTowardsTargetVector * LocationAimWeighting);

                //Debug.Log(
                //    "needsToMoveToTarget: " + needsToMoveToTarget +
                //    ", needsSlowdown: " + needsSlowdown +
                //    ", closeEnough: " + closeEnough +
                //    ", slowdownVecor: " + slowdownVecor +
                //    ", velocityTollerance: " + velocityTollerance +
                //    ", reletiveLocation: " + reletiveLocation +
                //    ", turningVector: " + turningVector);

                _torqueApplier.TurnToVectorInWorldSpace(turningVector);

                if (VectorArrow != null)
                {
                    VectorArrow.rotation = Quaternion.LookRotation(turningVector);
                    //VectorArrow.localScale = Vector3.one * turningVector.magnitude;
                }

                //try firing the main engine even with no fuel to turn it off if there is no fuel.
                SetEngineActivationState(IsAimedAtWorldVector(turningVector) && !closeEnough);
            }
            else
            {
                SetEngineActivationState(false);  //turn off the engine
            }
        }
        
        private Vector3 CalculateSlowdownVector(PotentialTarget target, float approachVelocity, float absoluteLocationTollerance)
        {
            var targetsVelosity = WorldSpaceReletiveVelocityOfTarget(target);
            var targetsSpeed = targetsVelosity.magnitude;

            return targetsVelosity;
        }
    }
}
