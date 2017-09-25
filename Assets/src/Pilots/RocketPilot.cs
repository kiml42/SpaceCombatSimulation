using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using Assets.Src.Targeting;
using UnityEngine;
using System;

namespace Assets.Src.Pilots
{
    class RocketPilot : BasePilot
    {
        public float CollisionDetectionDistance;

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
                //float timeToImpact;
                //var friendly = FriendlyAvoidenceVector(out timeToImpact);

                var reletiveLocation = ReletiveLocationInWorldSpace(target);
                var cancelationVector = VectorToCancelLateralVelocityInWorldSpace(target);

                var targetReletiveVelocity = WorldSpaceReletiveVelocityOfTarget(target);

                var turningVector = (targetReletiveVelocity.magnitude * targetReletiveVelocity.magnitude * cancelationVector) + (reletiveLocation * LocationAimWeighting);

                //Debug.Log("Pilot angle: " + Vector3.Angle(turningVector, _pilotObject.transform.forward));
                if(Vector3.Angle(turningVector, _pilotObject.transform.forward) > CloseEnoughAngle)
                {
                    _torqueApplier.TurnToVectorInWorldSpace(turningVector);
                }
                                
                SetTurningVectorOnEngines(turningVector);
                SetPrimaryTranslationVectorOnEngines(reletiveLocation);
                SetSecondaryTranslateVectorOnEngines(cancelationVector);

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

        //private Vector3? FriendlyAvoidenceVector(out float timeToimpact)
        //{
        //    var ray = new Ray(_pilotObject.position, _pilotObject.velocity);

        //    RaycastHit hit;

        //    if (Physics.Raycast(ray, out hit, CollisionDetectionDistance, -1, QueryTriggerInteraction.Ignore))
        //    {
        //        if (hit.transform.tag == _pilotObject.tag)
        //        {
        //            //isFriendly
        //            //TODO calculate this.
        //            timeToimpact = 1;
        //            return -VectorToCancelLateralVelocityInWorldSpace(new Target(hit.rigidbody));
        //        }
        //    }
        //    timeToimpact = 0;
        //    return null;
        //}
    }
}
