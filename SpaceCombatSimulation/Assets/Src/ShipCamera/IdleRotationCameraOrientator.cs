using UnityEngine;
using System;

namespace Assets.Src.ShipCamera
{
    public class IdleRotationCameraOrientator : ManualCameraOrientator
    {        
        public override bool HasTargets { get { return true; } }

        public override float Priority { get { return PriorityMultiplier; } }

        public override string Description
        {
            get
            {
                return "IdleRotation";
            }
        }

        public float SetBack = 50;
        public float IdleRotationSpeed = -500;

        public float FieldOfView = 80;
                
        protected override ShipCamTargetValues CalculateAutomaticTargets()
        {
            Rigidbody target = null;
            if (_shipCam != null && (_shipCam.FollowedTarget != null || _shipCam.TargetToWatch != null))
                target = _shipCam.FollowedTarget ?? _shipCam.TargetToWatch;
            var referenceVelocity = Vector3.zero;
            var parentLocationTarget = Vector3.zero;
            var up = Vector3.up;
            if (target != null)
            {
                parentLocationTarget = target.position;
                referenceVelocity = target.velocity;
                up = target.transform.up;
            }
            var automaticParentPollTarget = Quaternion.AngleAxis(Time.deltaTime * IdleRotationSpeed, up) * transform.forward;

            return new ShipCamTargetValues(parentLocationTarget, automaticParentPollTarget, parentLocationTarget - (transform.forward * SetBack), automaticParentPollTarget, FieldOfView, referenceVelocity, up);
        }
    }
}