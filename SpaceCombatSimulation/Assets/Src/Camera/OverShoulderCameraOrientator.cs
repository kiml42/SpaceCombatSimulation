using UnityEngine;
using System;

namespace Assets.Src.Controllers
{
    public class OverShoulderCameraOrientator : BaseCameraOrientator
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

        private Quaternion _parentOrientationTarget;
        private float _watchDistance;

        public override Quaternion ParentOrientationTarget { get { return _parentOrientationTarget; } }

        private Quaternion _cameraOrientationTarget;
        public override Quaternion CameraOrientationTarget { get { return _cameraOrientationTarget; } }

        private Vector3 _parentPollTarget;
        public override Vector3 ParentPollTarget { get { return _parentPollTarget; } }

        private Vector3 _cameraPollTarget;
        public override Vector3 CameraPollTarget { get { return _cameraPollTarget; } }

        private float _cameraFieldOfView;
        public override float CameraFieldOfView { get { return _cameraFieldOfView; } }

        private bool _hasTargets;
        public override bool HasTargets { get { return _hasTargets; } }
        
        public override float Priority
        {
            get
            {
                return _watchDistance * PriorityMultiplier;
            }
        }

        // Update is called once per frame
        void FixedUpdate()
        {
            _hasTargets = _shipCam != null && _shipCam.FollowedTarget != null && _shipCam.TargetToWatch != null && _shipCam.FollowedTarget != _shipCam.TargetToWatch;
            if (_hasTargets)
            {
                //Debug.Log("Following " + _followedTarget.Transform.name + ", Watching " + _targetToWatch.Transform.name);
                //rotate enpty parent
                _parentPollTarget = (_shipCam.TargetToWatch.position - transform.position);
                _parentOrientationTarget = Quaternion.LookRotation(_parentPollTarget);

                _referenceVelocity = _shipCam.FollowedTarget.velocity;

                _watchDistance = Vector3.Distance(transform.position, _shipCam.TargetToWatch.position);

                //move the focus
                _focusDistance = Mathf.Lerp(_focusDistance, _watchDistance, Time.deltaTime * FocusMoveSpeed);

                _cameraFieldOfView = Clamp((float)(FocusAngleMultiplier * Math.Pow(_focusDistance, FocusAnglePower)), 1, 90);

                var setBack = SetbackIntercept - _focusDistance * SetBackMultiplier;
                _cameraLocationTarget = DefaultCamLocation.position + (DefaultCamLocation.forward * setBack);


                if (Quaternion.Angle(_parentOrientationTarget, transform.rotation) < NearlyAimedAngle)
                {
                    //rotate the camera itself - only if the parent is looking in vaguely the right direction.
                    _cameraPollTarget = (_shipCam.TargetToWatch.position - _shipCam.Camera.transform.position);
                    _cameraOrientationTarget = Quaternion.LookRotation(_cameraPollTarget);
                } else
                {
                    _cameraPollTarget = _shipCam.Camera.transform.forward;
                    _cameraOrientationTarget = _shipCam.Camera.transform.rotation;
                }
            }
        }
    }
}