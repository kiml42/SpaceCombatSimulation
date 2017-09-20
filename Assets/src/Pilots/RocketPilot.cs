using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.Src.Pilots
{
    class RocketPilot : BasePilot
    {
        public RocketPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, Transform engine, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            AngleTollerance = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            LocationAimWeighting = 1;

            AddEngine(engine);
        }

        public RocketPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<Transform> engines, float shootAngle, float fuel, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            AngleTollerance = shootAngle;
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
            AngleTollerance = shootAngle;
            RemainingFuel = fuel;
            StartDelay = startDelay;
            LocationAimWeighting = 1;

            AddEngine(pilotAndEngine.transform);
        }

        public override void Fly(PotentialTarget target)
        {
            RemoveNullEngines();
            if (ShouldTurn() && HasFuel())
            {
                var reletiveLocation = ReletiveLocationInWorldSpace(target);
                var cancelationVector = VectorToCancelLateralVelocityInWorldSpace(target);

                var targetReletiveVelocity = WorldSpaceReletiveVelocityOfTarget(target);

                var turningVector = (targetReletiveVelocity.magnitude * targetReletiveVelocity.magnitude * cancelationVector) + (reletiveLocation * LocationAimWeighting);

                _torqueApplier.TurnToVectorInWorldSpace(turningVector);
                
                //try firing the main engine even with no fuel to turn it off if there is no fuel.
                SetEngineActivationState(IsAimedAtWorldVector(turningVector));
                if (VectorArrow != null && turningVector.magnitude > 0)
                {
                    VectorArrow.rotation = Quaternion.LookRotation(turningVector);
                }
            }
            else
            {
                SetEngineActivationState(false);  //turn off the engine
            }
        }
    }
}
