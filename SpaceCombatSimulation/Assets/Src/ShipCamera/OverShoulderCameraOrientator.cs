using UnityEngine;
using System;

namespace Assets.Src.ShipCamera
{
    public class OverShoulderCameraOrientator : ManualCameraOrientator
    {
        /// <summary>
        /// rate at which the camera will zoom in and out.
        /// </summary>
        public float FocusMoveSpeed = 1;

        public float FocusAnglePower = -0.67f;
        public float FocusAngleMultiplier = 1000;
        public float SetbackIntercept = -70;
        public float SetBackMultiplier = 0.5f;
        
        /// <summary>
        /// when the parent is within this angle of looking at the watched object, the camera tself starts tracking.
        /// </summary>
        public float NearlyAimedAngle = 3;
        
        public Transform DefaultCamLocation;

        public override bool HasTargets { get { return _shipCam?.FollowedTarget != null; } }

        public Vector3 LookAtLocation => _shipCam.WatchedRigidbody != null && _shipCam.WatchedRigidbody != _shipCam.FollowedTarget
                ? _shipCam.WatchedRigidbody.position
                : _shipCam.FollowedTarget.position + (_shipCam.FollowedTarget.transform.forward * 1000);

        public override float Priority
        {
            get
            {
                return GetWatchDistance() * PriorityMultiplier;
            }
        }
        
        private float GetWatchDistance()
        {
            return Vector3.Distance(transform.position, LookAtLocation);
        }

        public override string Description
        {
            get
            {
                return "OverShoulder";
            }
        }

        protected override ShipCamTargetValues CalculateAutomaticTargets()
        {
            if (HasTargets)
            {
                //Debug.Log("Following " + _shipCam.FollowedTarget + ", Watching target: " + _shipCam.WatchedRigidbody + " Actual watch location: " + LookAtLocation);
                //rotate empty parent

                Vector3 automaticParentPoleTarget = GetParentPoleTarget();

                Vector3 cameraPoleTarget = GetCameraPoleTarget(automaticParentPoleTarget);

                var referenceVelocity = _shipCam.FollowedTarget.velocity;

                //move the focus
                var focusDistance = GetWatchDistance();

                var automaticFieldOfView = Clamp((float)(FocusAngleMultiplier * Math.Pow(focusDistance, FocusAnglePower)), 1, 90);

                var setBack = SetbackIntercept - focusDistance * SetBackMultiplier;
                var cameraLocationTarget = DefaultCamLocation.position + (DefaultCamLocation.forward * setBack);

                return new ShipCamTargetValues(_shipCam.FollowedTarget.position, automaticParentPoleTarget, cameraLocationTarget, cameraPoleTarget, automaticFieldOfView, referenceVelocity, UpVector);
            }
            return null;
        }

        private Vector3 GetCameraPoleTarget(Vector3 automaticParentPoleTarget)
        {
            if (!ManualPanMode && Vector3.Angle(automaticParentPoleTarget, transform.forward) < NearlyAimedAngle)
            {
                //rotate the camera itself - only if the parent is looking in vaguely the right direction.
                return LookAtLocation - _shipCam.Camera.transform.position;
            }

            return DefaultCamLocation.forward;
        }

        private Vector3 GetParentPoleTarget()
        {
            return LookAtLocation - _shipCam.FollowedTarget.position;
        }
    }
}