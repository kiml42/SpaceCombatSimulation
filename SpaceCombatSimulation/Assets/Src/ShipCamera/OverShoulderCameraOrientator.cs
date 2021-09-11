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

        public override bool HasTargets { get { return _shipCam != null && _shipCam.FollowedTarget != null && _shipCam.WatchedRigidbody != null && _shipCam.FollowedTarget != _shipCam.WatchedRigidbody; } }
        
        public override float Priority
        {
            get
            {
                return GetWatchDistance() * PriorityMultiplier;
            }
        }
        
        private float GetWatchDistance()
        {
            return Vector3.Distance(transform.position, _shipCam.WatchedRigidbody.position);
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
                //Debug.Log("Following " + _followedTarget.Transform.name + ", Watching " + _targetToWatch.Transform.name);
                //rotate enpty parent
                
                var automaticParentPollTarget = (_shipCam.WatchedRigidbody.position - _shipCam.FollowedTarget.position);
                var cameraPollTarget = DefaultCamLocation.forward;
                if (!ManualPanMode && Vector3.Angle(automaticParentPollTarget, transform.forward) < NearlyAimedAngle)
                {
                    //rotate the camera itself - only if the parent is looking in vaguely the right direction.
                    cameraPollTarget = (_shipCam.WatchedRigidbody.position - _shipCam.Camera.transform.position);
                }

                var referenceVelocity = _shipCam.FollowedTarget.velocity;

                //move the focus
                var focusDistance =  GetWatchDistance();

                var automaticFieldOfView = Clamp((float)(FocusAngleMultiplier * Math.Pow(focusDistance, FocusAnglePower)), 1, 90);

                var setBack = SetbackIntercept - focusDistance * SetBackMultiplier;
                var cameraLocationTarget = DefaultCamLocation.position + (DefaultCamLocation.forward * setBack);

                //Debug.Log($"OverShoulderCameraOrientator");
                return new ShipCamTargetValues(_shipCam.FollowedTarget.position, automaticParentPollTarget, cameraLocationTarget, cameraPollTarget, automaticFieldOfView, referenceVelocity, UpVector);
            }
            return null;
        }
    }
}