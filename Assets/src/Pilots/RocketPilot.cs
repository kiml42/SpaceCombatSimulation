using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.src.Pilots
{
    class RocketPilot : BasePilot, IRocketPilot
    {
        public RocketPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, Transform engine, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            LocationAimWeighting = 1;

            AddEngine(engine);
        }

        public RocketPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<Transform> engines, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            LocationAimWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        public RocketPilot(ITorqueApplier torqueApplier, Rigidbody pilotAndEngine, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotAndEngine;
            _torqueApplier = torqueApplier;
            _shootAngle = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            LocationAimWeighting = 1;

            AddEngine(pilotAndEngine.transform);
        }

        public void AddEngine(Transform engine)
        {
            _engines.Add(engine);
        }

        public void FlyAtTarget(PotentialTarget target)
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
                if (VectorArrow != null)
                {
                    VectorArrow.rotation = Quaternion.LookRotation(turningVector);
                    //VectorArrow.localScale = Vector3.one * turningVector.magnitude;
                }
            }
            else
            {
                SetEngineActivationState(false);  //turn off the engine
            }
        }
    }
}
