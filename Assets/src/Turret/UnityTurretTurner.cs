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
            _turnTableHinge = turnTable.GetComponent("HingeJoint") as HingeJoint;
            _elevationHub = elevationHub;
            _elevationHubHinge = elevationHub.GetComponent("HingeJoint") as HingeJoint;
            _projectileSpeed = projectileSpeed;
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
            if (target != null && target.TargetTransform.IsValid() && _turnTable != null && _elevationHub != null)
            {
                HingeJoint hinge = _turnTable.GetComponent("HingeJoint") as HingeJoint;
                if(hinge != null)
                {
                    //Debug.Log(_thisTurret.name + " Turning to target with named " + target.Target.name + " with score " + target.Score);

                    //Debug.Log("getting location in turn table space");
                    
                    var LocationInTurnTableSpace = target.LocationInTurnTableSpace(_turnTable, _projectileSpeed);

                    TurnToTarget(_turnTableHinge, LocationInTurnTableSpace);
                    
                    //var locationInElevationHubSpace = target.LocationInElevationHubSpace(_thisTurret);
                    var locationInElevationHubSpace = target.LocationInElevationHubSpaceAfterTurnTableTurn(_thisTurret, _turnTable.transform, _elevationHub, _projectileSpeed);

                    TurnToTarget(_elevationHubHinge, locationInElevationHubSpace);

                    var location = target.TargetTransform.position;
                    var relative = target.LocationInTurnTableSpace(_turnTable, _projectileSpeed);
                    
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

        private void TurnToTarget(HingeJoint hingeToTurn, Vector3 relativeLocation)
        {
            if (hingeToTurn != null)
            {
                JointMotor motor = hingeToTurn.motor;
                motor.force = 30;
                relativeLocation.y = 0;
                motor.targetVelocity = relativeLocation.normalized.x * 500;
                //motor.freeSpin = false;
                hingeToTurn.motor = motor;
                //hinge.useMotor = true;
                //Debug.Log(objectToTurn.name + " turning at " + hinge.motor.targetVelocity);
            }
        }
    }
}
