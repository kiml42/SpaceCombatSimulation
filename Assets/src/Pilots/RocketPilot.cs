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
        /// <summary>
        /// If the rocket is ogoing to hit a friendly within this time, it will turn and push away with all engines
        /// </summary>
        public float TimeThresholdForMaximumEvasion = 2;

        /// <summary>
        /// If the rocket is ogoing to hit a friendly within this time, it will push away with all engines, but still turn as usual
        /// </summary>
        public float TimeThresholdForMediumEvasion = 4;
        
        /// <summary>
        /// If the rocket is ogoing to hit a friendly within this time, engines that point in a direction that will help evade will fire, but the others will still try to track the target.
        /// </summary>
        public float TimeThresholdForMinimalEvasion = 6;

        private int _evasionModeTimeout = 0;
        private FriendlyAvoidencelevel _evasionLevel;
        private Vector3 _friendlyAvoidenceVector;
        private Vector3 _vectorAwayFromFriendly;
        public int EvasionModeTimeMultiplier = 30;

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

        public override void Fly(Target target)
        {
            RemoveNullEngines();
            if (ShouldTurn() && HasStarted())
            {
                UpdateFriendlyAvoidenceLevel();
                
                if(_evasionLevel == FriendlyAvoidencelevel.MAX)
                {
                    //Impact is imanent, push and turn away.
                    Debug.Log("maximum evasion !");
                    SetFlightVectors(_friendlyAvoidenceVector, _friendlyAvoidenceVector, _vectorAwayFromFriendly);
                    return;
                }

                var reletiveLocation = ReletiveLocationInWorldSpace(target);
                var cancelationVector = VectorToCancelLateralVelocityInWorldSpace(target);

                var targetReletiveVelocity = WorldSpaceReletiveVelocityOfTarget(target);

                var turningVector = (targetReletiveVelocity.magnitude * targetReletiveVelocity.magnitude * cancelationVector) + (reletiveLocation * LocationAimWeighting);
                
                var primaryVector = _evasionLevel == FriendlyAvoidencelevel.MED
                    ? _friendlyAvoidenceVector 
                    : reletiveLocation;

                var secondaryVector = cancelationVector;
                if (_evasionLevel == FriendlyAvoidencelevel.MIN) {
                    //set the secondary to the friendlyAvoidenceVector, and primary to the turningVector
                    //so engines will fire if they are on the ark between the friendlyAvoidenceVector, and the turningVector
                    secondaryVector =  _friendlyAvoidenceVector;
                    primaryVector = turningVector;  //turning vector is used instead of reletive location, so that the main engine 
                    //will still fire if the rocket is pointed at the turning vector, but not at the target.
                }

                SetFlightVectors(turningVector, primaryVector, secondaryVector);
                
                return;
            }

            SetFlightVectors(null, null);//turn off the engines
        }

        private void SetFlightVectors(Vector3? turningVector, Vector3? primaryTranslationVector, Vector3? secondaryTranslatonVector = null)
        {
            if (turningVector.HasValue)
            {
                //Debug.Log("Pilot angle: " + Vector3.Angle(turningVector, _pilotObject.transform.forward));
                if (Vector3.Angle(turningVector.Value, _pilotObject.transform.forward) > CloseEnoughAngle)
                {
                    _torqueApplier.TurnToVectorInWorldSpace(turningVector.Value);
                }
            }

            UpdateArrow(turningVector);
            SetTurningVectorOnEngines(turningVector);

            SetPrimaryTranslationVectorOnEngines(primaryTranslationVector);
            SetSecondaryTranslateVectorOnEngines(secondaryTranslatonVector);
        }

        private void UpdateArrow(Vector3? turningVector)
        {
            if(VectorArrow != null)
            {
                if (turningVector.HasValue && turningVector.Value.magnitude > 0)
                {
                    Debug.Log("Arrow on");
                    VectorArrow.rotation = Quaternion.LookRotation(turningVector.Value);
                    VectorArrow.localScale = Vector3.one;
                    return;
                }
                Debug.Log("Arrow off");
                VectorArrow.localScale = Vector3.zero;
            }
        }

        private FriendlyAvoidencelevel UpdateFriendlyAvoidenceLevel()
        {
            if(_evasionModeTimeout < 0)
            {
                _evasionLevel = FriendlyAvoidencelevel.NONE;
            }

            Debug.Log("casting ray from " + _pilotObject.position + " on vector " + _pilotObject.velocity);
            var ray = new Ray(_pilotObject.position, _pilotObject.velocity);

            RaycastHit hit;

            //this assumes stationary targets, but it's only for minimal evasion, so that should be okay
            //also, rockets should be going faster thatn the things they might hit.
            var collisionDetectionDistance = _pilotObject.velocity.magnitude * TimeThresholdForMinimalEvasion;

            if (Physics.Raycast(ray, out hit, collisionDetectionDistance, -1, QueryTriggerInteraction.Ignore))
            {
                if (hit.transform.tag == _pilotObject.tag)
                {
                    //isFriendly
                    var relativeVelocity = WorldSpaceReletiveVelocityOfTarget(hit.rigidbody);

                    var approachSpeed = relativeVelocity.magnitude;
                    
                    //var minShrapnelApproachSpeed = approachVelocity.magnitude - _shrapnelSpeed;
                    var distance = hit.distance;


                    _friendlyAvoidenceVector = - VectorToCancelLateralVelocityInWorldSpace(new Target(hit.rigidbody));
                    _vectorAwayFromFriendly = _pilotObject.position - hit.transform.position;

                    var timeToImpact = distance / approachSpeed;
                    Debug.Log(hit.transform.name + " is in the way, " + timeToImpact + " to impact. Evading on vector " + _friendlyAvoidenceVector + ", vector away = " + _vectorAwayFromFriendly);
                    
                    FriendlyAvoidencelevel newLevel = FriendlyAvoidencelevel.NONE;
                    
                    if (timeToImpact < TimeThresholdForMaximumEvasion)
                    {
                        newLevel = FriendlyAvoidencelevel.MAX;
                    } else if(timeToImpact < TimeThresholdForMediumEvasion)
                    {
                        newLevel = FriendlyAvoidencelevel.MED;
                    }
                    else if (timeToImpact < TimeThresholdForMinimalEvasion)
                    {
                        newLevel = FriendlyAvoidencelevel.MIN;
                    }

                    _evasionModeTimeout = Math.Max(_evasionModeTimeout, (int)newLevel * EvasionModeTimeMultiplier);

                    if(newLevel > _evasionLevel)
                    {

                        _evasionLevel = newLevel;
                    }
                }
            }

            _evasionModeTimeout--;
            return _evasionLevel;
        }

        internal enum FriendlyAvoidencelevel
        {
            NONE = 0, MIN = 1, MED = 2, MAX = 3
        }
    }
}
