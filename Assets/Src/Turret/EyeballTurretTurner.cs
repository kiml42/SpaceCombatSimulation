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
    public class EyeballTurretTurner : ITurretTurner
    {
        public float Torque = 30;
        public float SpeedMultiplier = 500;
        public float SpeedCap = 100;

        private readonly Rigidbody _thisTurret;
        private readonly PotentialTarget _restTarget;

        private readonly Rigidbody _ball;

        private readonly float? _projectileSpeed;

        public Transform VectorArrow;

        public EyeballTurretTurner(Rigidbody thisTurret, Rigidbody turnTable, Transform restTarget, float? projectileSpeed)
        {
            _thisTurret = thisTurret;
            if(restTarget != null)
            {
                _restTarget = new PotentialTarget(restTarget);
            }
            _ball = turnTable;
            _projectileSpeed = projectileSpeed;
        }

        public void ReturnToRest()
        {
            if(_restTarget != null)
            {
                TurnToTarget(_restTarget);
            }
        }

        public void TurnToTarget(Target target)
        {
            if (target != null && target.Transform.IsValid())
            {
                //Debug.Log(_thisTurret.name + " Turning to target with named " + target.Target.name + " with score " + target.Score);

                //Debug.Log("getting location in turn table space");
                var parentAngularV = _thisTurret.angularVelocity;

                var parentAngularVInTurntableSpace = _ball.transform.InverseTransformVector(parentAngularV);

                var LocationInTurnTableSpace = target.LocationInOthersSpace(_ball, _projectileSpeed);

                var TTCancelationSpeed = -parentAngularVInTurntableSpace.y * 180 / Mathf.PI;    //convert from radians per second to degrees per second
                

                //Debug.Log("vector" + vector);
                var vectorInBallSpace = _ball.transform.InverseTransformVector(LocationInTurnTableSpace);

                //Debug.Log(_pilot + " vectorInPilotSpace " + vectorInPilotSpace);
                var rotationVector = new Vector3(-vectorInBallSpace.y, vectorInBallSpace.x, 0);   //set z to 0 to not add spin
                if (rotationVector.magnitude < 0.1 && vectorInBallSpace.z < 0)
                {
                    //The target is exactly behind, turning in any direction will do.
                    //Debug.Log("Target is exactly behind");
                    rotationVector = new Vector3(1, 0, 0);
                }
                //Debug.Log("rotationVector" + rotationVector);

                var worldTorque = _ball.transform.TransformVector(rotationVector).normalized;

                var localSpaceVector = _ball.transform.InverseTransformVector(worldTorque).normalized;    //transform vector to torquer space
                _ball.AddRelativeTorque(Torque * localSpaceVector); //apply torque to torquer




                if (VectorArrow != null)
                {
                    if (LocationInTurnTableSpace.magnitude > 0)
                    {
                        VectorArrow.rotation = Quaternion.LookRotation(LocationInTurnTableSpace);
                        VectorArrow.localScale = Vector3.one;
                    }
                    else
                    {
                        VectorArrow.localScale = Vector3.zero;
                    }
                }

            }
        }
    }
}
