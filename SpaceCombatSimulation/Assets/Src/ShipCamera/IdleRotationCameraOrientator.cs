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

        public float StartRotatingDistance = 60;
                
        protected override ShipCamTargetValues CalculateAutomaticTargets()
        {
            Rigidbody target = null;
            if (_shipCam != null && (_shipCam.FollowedTarget != null || _shipCam.WatchedRigidbody != null))
                target = _shipCam.FollowedTarget != null ? _shipCam.FollowedTarget : _shipCam.WatchedRigidbody;
            var referenceVelocity = Vector3.zero;
            var parentLocationTarget = Vector3.zero;
            if (target != null)
            {
                parentLocationTarget = target.position;
                referenceVelocity = target.velocity;
            }

            var vectorToTargetLocation = transform.position - parentLocationTarget;
            var currentDistance = vectorToTargetLocation.magnitude;

            var automaticParentPollTarget = currentDistance < StartRotatingDistance
                ? Quaternion.AngleAxis(Time.deltaTime * IdleRotationSpeed, transform.up) * transform.forward 
                : vectorToTargetLocation;

            return new ShipCamTargetValues(parentLocationTarget, automaticParentPollTarget, parentLocationTarget - (transform.forward * SetBack), automaticParentPollTarget, FieldOfView, referenceVelocity, UpVector);
        }
    }
}