using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Assets.Src.Targeting;
using UnityEngine;
using Assets.Src.ObjectManagement;

namespace Assets.Src.Rocket
{
    class RocketEngineControl : IRocketEngineControl
    {
        public float RemainingFuel { get; private set; }
        public float SlowdownWeighting { get; set; }
        public float LocationAimWeighting { get; set; }
        
        public int StartDelay
        {
            get
            {
                return _startDelay;
            }
            set
            {
                _startDelay = value;
            }
        }

        public int TurningStartDelay
        {
            get
            {
                return _turningStartDelay;
            }
            set
            {
                _turningStartDelay = value;
            }
        }

        private List<Transform> _engines = new List<Transform>();
        
        private float _shootAngle;

        public int _startDelay = 0;
        private int _turningStartDelay;

        private ITorqueApplier _torqueApplier;

        private Rigidbody _pilotObject;

        public RocketEngineControl(ITorqueApplier torqueApplier, Rigidbody pilotObject, Transform engine, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            _startDelay = startDelay;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            AddEngine(engine);
        }

        public RocketEngineControl(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<Transform> engines, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            _startDelay = startDelay;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        public RocketEngineControl(ITorqueApplier torqueApplier, Rigidbody pilotAndEngine, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotAndEngine;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            _startDelay = startDelay;
            SlowdownWeighting = 10;
            LocationAimWeighting = 1;

            AddEngine(pilotAndEngine.transform);
        }

        public void AddEngine(Transform engine)
        {
            _engines.Add(engine);
        }

        public void FlyAtTargetMaxSpeed(PotentialTarget target)
        {
            RemoveNullEngines();
            if (ShouldTurn() && HasFuel())
            {
                var reletiveLocation = VectorTowardsTargetInWorldSpace(target);
                var cancelationVector = VectorToCancelLateralVelocityInWorldSpace(target);

                var turningVector = cancelationVector + (reletiveLocation * LocationAimWeighting);

                _torqueApplier.TurnToVectorInWorldSpace(turningVector);
                
                //try firing the main engine even with no fuel to turn it off if there is no fuel.
                SetEngineActivationState(IsAimedAtWorldVector(turningVector));
            }
            else
            {
                SetEngineActivationState(false);  //turn off the engine
            }
        }

        public void FlyToTarget(PotentialTarget target, float approachVelocity = 0, float absoluteLocationTollerance = 20, float velocityTollerance = 1)
        {
            RemoveNullEngines();
            if (ShouldTurn())
            {
                var reletiveLocation = VectorTowardsTargetInWorldSpace(target);
                var needsToMoveToTarget = reletiveLocation.magnitude > absoluteLocationTollerance;

                var moveTowardsTargetVector = needsToMoveToTarget ? reletiveLocation : Vector3.zero;

                var targetsVelosity = WorldSpaceReletiveVelocityOfTarget(target);
                var targetsSpeed = targetsVelosity.magnitude;
                var needsSlowdown = targetsSpeed > (approachVelocity + velocityTollerance);
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
                
                //try firing the main engine even with no fuel to turn it off if there is no fuel.
                SetEngineActivationState(IsAimedAtWorldVector(turningVector) && !closeEnough);
            }
            else
            {
                SetEngineActivationState(false);  //turn off the engine
            }
        }

        private bool ShouldTurn()
        {
            _turningStartDelay--;
            StartDelay--;
            return _turningStartDelay <= 0;
        }

        private Vector3 CalculateSlowdownVector(PotentialTarget target, float approachVelocity, float absoluteLocationTollerance)
        {
            var targetsVelosity = WorldSpaceReletiveVelocityOfTarget(target);
            var targetsSpeed = targetsVelosity.magnitude;

            return targetsVelosity;
        }

        private bool HasFuel()
        {
            //Debug.Log("RemainignFule:" + RemainingFuel);
            var hasFuel = RemainingFuel > 0 && StartDelay <= 0;
            if (!hasFuel)
            {
                _torqueApplier.Deactivate();
            }
            else
            {
                _torqueApplier.Activate();
            }
            return hasFuel;
        }

        private Vector3 VectorTowardsTargetInWorldSpace(PotentialTarget target)
        {
            if (_pilotObject != null && target.Target.IsValid())
            {

                var location = target.Target.position - _pilotObject.position;
                return location;
            }

            if (target.Target.IsInvalid())
            {
                Debug.Log("Target transform is invalid");
            }
            if(_pilotObject == null)
            {
                Debug.Log("_pilotObject is null");
            }
            return Vector3.zero;
        }

        private Vector3 VectorToCancelLateralVelocityInWorldSpace(PotentialTarget target)
        {
            var vectorTowardsTarget = VectorTowardsTargetInWorldSpace(target);
            var targetReletiveVelocity = WorldSpaceReletiveVelocityOfTarget(target);

            //https://math.stackexchange.com/questions/1455740/resolve-u-into-components-that-are-parallel-and-perpendicular-to-any-other-nonze

            var numerator = Vector3.Dot(targetReletiveVelocity, vectorTowardsTarget);
            var denominator = Vector3.Dot(vectorTowardsTarget, vectorTowardsTarget);
            var division = numerator / denominator;

            var perpendicularComponent = targetReletiveVelocity - (division * vectorTowardsTarget);

            return perpendicularComponent;
        }

        private Vector3 WorldSpaceReletiveVelocityOfTarget(PotentialTarget target)
        {
            var targetRigidBody = target.Target.GetComponent("Rigidbody") as Rigidbody;


            var targetsVelocity = targetRigidBody == null ? Vector3.zero : targetRigidBody.velocity;
            var ownVelocity = _pilotObject.velocity;
            return targetsVelocity - ownVelocity;
        }

        private void SetEngineActivationState(bool fire)
        {
            if (fire && HasFuel())
            {
                foreach (var engine in _engines)
                {
                    engine.SendMessage("TurnOn");
                    //every engine uses 1 fuel
                    RemainingFuel--;
                }
            } else
            {
                foreach (var engine in _engines)
                {
                    engine.SendMessage("TurnOff");
                }
            }
        }

        private void RemoveNullEngines()
        {
            _engines = _engines.Where(t => t.IsValid()).Distinct().ToList();
        }

        private bool IsAimedAtWorldVector(Vector3 worldSpaceVector)
        {
            if (_pilotObject != null)
            {
                var angle = Vector3.Angle(_pilotObject.transform.forward, worldSpaceVector);
                return angle < _shootAngle;
            }

            //Debug.Log("No Engines (IsAimedAtWorldVector)");
            return false;
        }
    }
}
