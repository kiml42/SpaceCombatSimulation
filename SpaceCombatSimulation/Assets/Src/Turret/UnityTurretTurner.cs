﻿using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class UnityTurretTurner : ITurretTurner
    {
        public float TurnTableTorque = 30;
        public float TurnTableSpeedMultiplier = 500;
        public float TurnTableSpeedCap = 100;

        public float EHTorque = 30;
        public float EHSpeedMultiplier = 500;
        public float EHSpeedCap = 100;

        private readonly Rigidbody _thisTurret;
        private readonly PotentialTarget _restTarget;
        private readonly Rigidbody _turnTable;
        private readonly HingeJoint _turnTableHinge;
        private readonly Rigidbody _elevationHub;
        private readonly HingeJoint _elevationHubHinge;
        private readonly float? _projectileSpeed;

        public UnityTurretTurner(Rigidbody thisTurret, Rigidbody turnTable, Rigidbody elevationHub, Transform restTarget, float? projectileSpeed)
        {
            _thisTurret = thisTurret;
            if(restTarget != null)
            {
                _restTarget = new PotentialTarget(restTarget);
            }
            _turnTable = turnTable;
            _turnTableHinge = turnTable.GetComponent<HingeJoint>();
            _elevationHub = elevationHub;
            _elevationHubHinge = elevationHub.GetComponent<HingeJoint>();
            _projectileSpeed = projectileSpeed;
        }

        public void ReturnToRest()
        {
            if(_restTarget != null)
            {
                TurnToTarget(_restTarget.Target);
            }
        }

        public void TurnToTarget(ITarget target)
        {
            if (target != null && target.Transform.IsValid() && _turnTableHinge != null && _elevationHubHinge != null)
            {
                //Debug.Log(_thisTurret.name + " Turning to target with named " + target.Target.name + " with score " + target.Score);

                //Debug.Log("getting location in turn table space");
                var parentAngularV = _thisTurret.angularVelocity;

                var parentAngularVInTurntableSpace = _turnTable.transform.InverseTransformVector(parentAngularV);

                var LocationInTurnTableSpace = target.LocationInOthersSpace(_turnTable, _projectileSpeed);

                var TTCancelationSpeed = -parentAngularVInTurntableSpace.y * 180 / Mathf.PI;    //convert from radians per second to degrees per second

                TurnToTarget(_turnTableHinge, LocationInTurnTableSpace, TurnTableTorque, TurnTableSpeedMultiplier, TurnTableSpeedCap, TTCancelationSpeed);
                    
                //var locationInElevationHubSpace = target.LocationInElevationHubSpace(_thisTurret);
                var locationInElevationHubSpace = target.LocationInElevationHubSpaceAfterTurnTableTurn(_thisTurret, _turnTable.transform, _elevationHub, _projectileSpeed);
                
                var parentAngularVInEHSpace = _elevationHub.transform.InverseTransformVector(parentAngularV);

                var EHCancelationSpeed = -parentAngularVInEHSpace.y * 180 / Mathf.PI;    //convert from radians per second to degrees per second

                TurnToTarget(_elevationHubHinge, locationInElevationHubSpace, EHTorque, EHSpeedMultiplier, EHSpeedCap, EHCancelationSpeed);
            }
        }

        private void TurnToTarget(HingeJoint hingeToTurn, Vector3 relativeLocation, float MotorForce, float MotorSpeedMultiplier, float speedCap, float parentCancelationSpeed)
        {
            if (hingeToTurn != null)
            {
                JointMotor motor = hingeToTurn.motor;
                motor.force = MotorForce;
                relativeLocation.y = 0;
                motor.targetVelocity = Math.Min(speedCap, parentCancelationSpeed + (relativeLocation.normalized.x * MotorSpeedMultiplier));
                //motor.freeSpin = false;
                hingeToTurn.motor = motor;
                //hinge.useMotor = true;
                //Debug.Log(objectToTurn.name + " turning at " + hinge.motor.targetVelocity);
            }
        }
    }
}
