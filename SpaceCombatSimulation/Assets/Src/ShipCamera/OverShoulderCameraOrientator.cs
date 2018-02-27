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
        /// The distance the camera is trying to zoom in to to see well.
        /// Should be private, but exposed for debuging reasons.
        /// </summary>
        private float _focusDistance = 0;

        /// <summary>
        /// when the parent is within this angle of looking at the watched object, the camera tself starts tracking.
        /// </summary>
        public float NearlyAimedAngle = 3;

        public override Vector3 ParentLocationTarget { get { return _shipCam.FollowedTarget.position; } }

        private Vector3 _referenceVelocity;
        public override Vector3 ReferenceVelocity { get { return _referenceVelocity; } }

        public Transform DefaultCamLocation;
        private Vector3 _cameraLocationTarget;
        public override Vector3 CameraLocationTarget { get { return _cameraLocationTarget; } }
                
        public override Quaternion CameraOrientationTarget { get { return Quaternion.LookRotation(_cameraPollTarget); } }
        
        private Vector3 _cameraPollTarget;
        public override Vector3 CameraPollTarget { get { return _cameraPollTarget; } }
                
        public override bool HasTargets { get { return _shipCam != null && _shipCam.FollowedTarget != null && _shipCam.TargetToWatch != null && _shipCam.FollowedTarget != _shipCam.TargetToWatch; } }
        
        public override float Priority
        {
            get
            {
                return GetWatchDistance() * PriorityMultiplier;
            }
        }
        
        private float GetWatchDistance()
        {
            return Vector3.Distance(transform.position, _shipCam.TargetToWatch.position);
        }
        public override string Description
        {
            get
            {
                return "OverShoulder";
            }
        }

        private Vector3 _automaticParentPollTarget;
        protected override Vector3 AutomaticParentPollTarget
        {
            get
            {
                return _automaticParentPollTarget;
            }
        }

        private float _automaticFieldOfView;
        protected override float AutomaticFieldOfView
        {
            get
            {
                return _automaticFieldOfView;
            }
        }

        protected override ShipCamTargetValues CalculateAutomaticTargets()
        {
            if (HasTargets)
            {
                //Debug.Log("Following " + _followedTarget.Transform.name + ", Watching " + _targetToWatch.Transform.name);
                //rotate enpty parent
                
                _automaticParentPollTarget = (_shipCam.TargetToWatch.position - ParentLocationTarget);
                if (!ManualMode && Vector3.Angle(_automaticParentPollTarget, transform.forward) < NearlyAimedAngle)
                {
                    //rotate the camera itself - only if the parent is looking in vaguely the right direction.
                    _cameraPollTarget = (_shipCam.TargetToWatch.position - _shipCam.Camera.transform.position);
                }
                else
                {
                    _cameraPollTarget = DefaultCamLocation.forward;
                }

                _referenceVelocity = _shipCam.FollowedTarget.velocity;

                //move the focus
                _focusDistance =  GetWatchDistance();

                _automaticFieldOfView = Clamp((float)(FocusAngleMultiplier * Math.Pow(_focusDistance, FocusAnglePower)), 1, 90);

                var setBack = SetbackIntercept - _focusDistance * SetBackMultiplier;
                _cameraLocationTarget = DefaultCamLocation.position + (DefaultCamLocation.forward * setBack);
                return new ShipCamTargetValues(_shipCam.FollowedTarget.position, _automaticParentPollTarget, _cameraLocationTarget, _cameraPollTarget, _automaticFieldOfView, _referenceVelocity, _shipCam.FollowedTarget.transform.up);
            }
            return null;
        }
    }
}