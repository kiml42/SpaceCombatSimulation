using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using System.Linq;
using System;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.ObjectManagement;


namespace Assets.Src.Controllers
{
    public class OverShoulderCameraOrientator : BaseCameraOrientator
    {
        /// <summary>
        /// tag of a child object of a fhing to watch or follow.
        /// </summary>
        public List<string> MainTags = new List<string> { "SpaceShip" };
        public List<string> SecondaryTags = new List<string> { "Projectile" };
        private List<string> _tags = new List<string> { "SpaceShip", "Projectile" };

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
        public float _focusDistance = 0;

        /// <summary>
        /// when the parent is within this angle of looking at the watched object, the camera tself starts tracking.
        /// </summary>
        public float NearlyAimedAngle = 3;
        
        public float DefaultFocusDistance = 200;

        public override Vector3 ParentLocationTarget { get { return _shipCam.FollowedTarget.position; } }

        public Transform DefaultCamLocation;
        private Vector3 _cameraLocationTarget;
        public override Vector3 CameraLocationTarget { get { return _cameraLocationTarget; } }

        private Quaternion _parentOrientationTarget;
        public override Quaternion ParentOrientationTarget { get { return _parentOrientationTarget; } }

        private Quaternion _cameraOrientationTarget;
        public override Quaternion CameraOrientationTarget { get { return _cameraOrientationTarget; } }

        public float _cameraFieldOfView;
        public override float CameraFieldOfView { get { return _cameraFieldOfView; } }
        
        public bool _hasTargets;
        public override bool HasTargets { get { return _hasTargets; } }

        // Update is called once per frame
        void FixedUpdate()
        {
            if (_shipCam.FollowedTarget != null && _shipCam.TargetToWatch != null && _shipCam.FollowedTarget != _shipCam.TargetToWatch)
            {
                _hasTargets = true;
                //Debug.Log("Following " + _followedTarget.Transform.name + ", Watching " + _targetToWatch.Transform.name);
                //rotate enpty parent
                var direction = (_shipCam.TargetToWatch.position - transform.position);
                _parentOrientationTarget = Quaternion.LookRotation(direction);

                //move the focus
                _focusDistance = Mathf.Lerp(_focusDistance, Vector3.Distance(transform.position, _shipCam.TargetToWatch.position), Time.deltaTime * FocusMoveSpeed);

                _cameraFieldOfView = Clamp((float)(FocusAngleMultiplier * Math.Pow(_focusDistance, FocusAnglePower)), 1, 90);

                var setBack = SetbackIntercept - _focusDistance * SetBackMultiplier;
                _cameraLocationTarget = DefaultCamLocation.position + (DefaultCamLocation.forward * setBack);

                if (Quaternion.Angle(_cameraOrientationTarget, transform.rotation) < NearlyAimedAngle)
                {
                    //rotate the camera itself - only if the parent is looking in vaguely the right direction.
                    var camDirection = (_shipCam.TargetToWatch.position - _shipCam.Camera.transform.position);
                    _cameraOrientationTarget = Quaternion.LookRotation(camDirection);
                }
            } else
            {
                _hasTargets = false;
            }
        }
    }
}