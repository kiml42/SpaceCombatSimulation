using UnityEngine;
using System;

namespace Assets.Src.Controllers
{
    public class SideViewCameraOrientator : BaseCameraOrientator
    {
        private Vector3 _parentLocationTarget;
        public override Vector3 ParentLocationTarget { get { return _parentLocationTarget; } }

        private Vector3 _referenceVelocity;
        public override Vector3 ReferenceVelocity { get { return _referenceVelocity; } }

        private Vector3 _cameraLocationTarget;
        public override Vector3 CameraLocationTarget { get { return _cameraLocationTarget; } }

        private Quaternion _parentOrientationTarget;
        public override Quaternion ParentOrientationTarget { get { return _parentOrientationTarget; } }
        
        public override Quaternion CameraOrientationTarget { get { return CameraLocationOrientation.rotation; } }

        private float _cameraFieldOfView;
        public override float CameraFieldOfView { get { return _cameraFieldOfView; } }

        private bool _hasTargets;
        public override bool HasTargets { get { return _hasTargets; } }

        [Tooltip("The distance at which this Orientator starts to get a positive score.")]
        public float MaxDistance = 2000;
        public override float Priority
        {
            get
            {
                return (MaxDistance - _watchDistance) * PriorityMultiplier;
            }
        }

        private float _watchDistance;

        public float AngleProportion = 1.8f;

        public float MinimumDistance = 400;

        public Transform CameraLocationOrientation;
        
        // Update is called once per frame
        void Update()
        {
            _hasTargets = _shipCam != null && _shipCam.FollowedTarget != null && _shipCam.TargetToWatch != null && _shipCam.FollowedTarget != _shipCam.TargetToWatch;
            if (_hasTargets)
            {
                _parentLocationTarget = (_shipCam.TargetToWatch.position + _shipCam.FollowedTarget.position) / 2;

                _referenceVelocity = (_shipCam.TargetToWatch.velocity + _shipCam.FollowedTarget.velocity) / 2;

                var vectorBetweenWatchedObjects = _shipCam.TargetToWatch.position - transform.position;

                _parentOrientationTarget = Quaternion.LookRotation(vectorBetweenWatchedObjects);
                
                _watchDistance = vectorBetweenWatchedObjects.magnitude;
                var setBack = Clamp(_watchDistance * 3, MinimumDistance, _watchDistance * 3);

                _cameraLocationTarget = CameraLocationOrientation.transform.position - CameraLocationOrientation.transform.forward * setBack;

                var cameraToTargetVector = _shipCam.TargetToWatch.transform.position - _cameraLocationTarget;
                var cameraToFollowedVector = _shipCam.FollowedTarget.transform.position - _cameraLocationTarget;

                var vectorToParent = CameraLocationOrientation.transform.forward;
                var baseAngle = Math.Max(
                    Vector3.Angle(vectorToParent, cameraToTargetVector),
                    Vector3.Angle(vectorToParent, cameraToFollowedVector)
                    );

                var desiredAngle = baseAngle * AngleProportion;
                _cameraFieldOfView = Clamp(desiredAngle, 1, 90);
            }
        }
    }
}