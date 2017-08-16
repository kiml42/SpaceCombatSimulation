using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Turret;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class UnityTurretTurner : ITurretTurner
    {
        Transform _thisTurret;
        PotentialTarget _restTarget;
        private readonly Transform _turnTable;
        private readonly Transform _elevationHub;

        public UnityTurretTurner(Transform thisTurret, Transform turnTable, Transform elevationHub, Transform restTarget)
        {
            _thisTurret = thisTurret;
            if(restTarget != null)
            {
                _restTarget = new PotentialTarget(restTarget, 0f);
            }
            _turnTable = turnTable;
            _elevationHub = elevationHub;
        }

        public void ReturnToRest()
        {
            if(_restTarget != null)
            {
                TurnToTarget(_restTarget);
            }
        }

        public void TurnToTarget(PotentialTarget target)
        {
            if (target != null && target.Target.IsValid() && _turnTable.IsValid() && _elevationHub.IsValid())
            {
                HingeJoint hinge = _turnTable.GetComponent("HingeJoint") as HingeJoint;
                if(hinge != null)
                {
                    //Debug.Log(_thisTurret.name + " Turning to target with named " + target.Target.name + " with score " + target.Score);

                    //Debug.Log("getting location in turn table space");
                    

                    var LocationInTurnTableSpace = target.LocationInTurnTableSpace(_thisTurret, _turnTable);

                    TurnToTarget(_turnTable, LocationInTurnTableSpace);
                    
                    //var locationInElevationHubSpace = target.LocationInElevationHubSpace(_thisTurret);
                    var locationInElevationHubSpace = target.LocationInElevationHubSpaceAfterTurnTableTurn(_thisTurret, _turnTable, _elevationHub, false);

                    TurnToTarget(_elevationHub, locationInElevationHubSpace);

                    var location = target.Target.transform.position;
                    var relative = target.LocationInTurnTableSpace(_thisTurret, _turnTable);
                    
                    JointMotor motor = hinge.motor;
                    motor.force = 30;

                    relative.y = 0;
                    motor.targetVelocity = relative.normalized.x * 500;
                    motor.freeSpin = false;
                    hinge.motor = motor;
                    hinge.useMotor = true;
                    //Debug.Log(hinge.motor.targetVelocity);
                }
            } else
            {
                //Debug.Log(_thisTurret.name + " Turning to null target");
            }
        }

        private void TurnToTarget(Transform objectToTurn, Vector3 relativeLocation)
        {
            if (objectToTurn != null)
            {
                HingeJoint hinge = objectToTurn.GetComponent("HingeJoint") as HingeJoint;
                if(hinge != null)
                {
                    JointMotor motor = hinge.motor;
                    motor.force = 30;
                    relativeLocation.y = 0;
                    motor.targetVelocity = relativeLocation.normalized.x * 500;
                    //motor.freeSpin = false;
                    hinge.motor = motor;
                    //hinge.useMotor = true;
                    //Debug.Log(objectToTurn.name + " turning at " + hinge.motor.targetVelocity);
                }
            }

        }
    }
}
