using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.Src.Pilots
{
    class RocketPilot : BasePilot
    {
        public RocketPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, EngineControler engine, float shootAngle, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            StartDelay = startDelay;
            LocationAimWeighting = 1;

            AddEngine(engine);
        }

        public RocketPilot(ITorqueApplier torqueApplier, Rigidbody pilotObject, List<EngineControler> engines, float shootAngle, int startDelay)
        {
            _pilotObject = pilotObject;
            _torqueApplier = torqueApplier;
            StartDelay = startDelay;
            LocationAimWeighting = 1;

            foreach (var engine in engines.ToList())
            {
                AddEngine(engine);
            }
        }

        public override void Fly(PotentialTarget target)
        {
            RemoveNullEngines();
            if (ShouldTurn() && HasStarted())
            {
                var reletiveLocation = ReletiveLocationInWorldSpace(target);
                var cancelationVector = VectorToCancelLateralVelocityInWorldSpace(target);

                var targetReletiveVelocity = WorldSpaceReletiveVelocityOfTarget(target);

                var turningVector = (targetReletiveVelocity.magnitude * targetReletiveVelocity.magnitude * cancelationVector) + (reletiveLocation * LocationAimWeighting);

                //Debug.Log("Pilot angle: " + Vector3.Angle(turningVector, _pilotObject.transform.forward));
                if(Vector3.Angle(turningVector, _pilotObject.transform.forward) > CloseEnoughAngle)
                {
                    _torqueApplier.TurnToVectorInWorldSpace(turningVector);
                }
                                
                //try firing the main engine even with no fuel to turn it off if there is no fuel.
                SetFlightVectorOnEngines(turningVector);
                if (VectorArrow != null && turningVector.magnitude > 0)
                {
                    VectorArrow.rotation = Quaternion.LookRotation(turningVector);
                }
            }
            else
            {
                SetFlightVectorOnEngines(null);  //turn off the engine
            }
        }
    }
}
