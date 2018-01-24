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
                Debug.Log(_thisTurret.name + " Turning to target with named " + target.Transform.name + " Location: " + target.Transform.position);
                
                var vectorInBallSpace = target.LocationInOthersSpace(_ball, _projectileSpeed);
                Debug.Log("location in ball space: " + vectorInBallSpace);
                
                //var parentAngularV = _thisTurret.angularVelocity;
                //var parentAngularVInBallSpace = _ball.transform.InverseTransformVector(parentAngularV);
                //TODO use this to correct for the rotation of the whole turret. - unless I make this frictionless
                
                var rotationVector = new Vector3(-vectorInBallSpace.y, vectorInBallSpace.x, 0);   //set z to 0 to not add spin
                if (rotationVector.magnitude < 0.1 && vectorInBallSpace.z < 0)
                {
                    //The target is exactly behind, turning in any direction will do.
                    Debug.Log("Target is exactly behind");
                    rotationVector = new Vector3(1, 0, 0);
                }
                Debug.Log("rotationVector" + rotationVector);

                var worldTorque = _ball.transform.TransformVector(rotationVector).normalized;

                var localSpaceVector = _ball.transform.InverseTransformVector(worldTorque).normalized;    //transform vector to torquer space
                _ball.AddRelativeTorque(Torque * localSpaceVector); //apply torque to torquer
                _thisTurret.AddRelativeTorque(Torque * -localSpaceVector); //apply torque to torquer

                if (VectorArrow != null)
                {
                    var WorldSpaceVectorToTarget = _ball.transform.TransformVector(vectorInBallSpace);
                    Debug.Log("WorldSpaceVectorToTarget: " + WorldSpaceVectorToTarget);
                    if (WorldSpaceVectorToTarget.magnitude > 0)
                    {
                        VectorArrow.rotation = Quaternion.LookRotation(WorldSpaceVectorToTarget);
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
