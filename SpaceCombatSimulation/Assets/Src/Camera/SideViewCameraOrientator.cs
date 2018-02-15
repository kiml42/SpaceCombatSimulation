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

        private Quaternion _parentAndCameraOrientationTarget;
        public override Quaternion ParentOrientationTarget { get { return _parentAndCameraOrientationTarget; } }
        
        public override Quaternion CameraOrientationTarget { get { return _parentAndCameraOrientationTarget; } }

        private float _cameraFieldOfView;
        public override float CameraFieldOfView { get { return _cameraFieldOfView; } }

        private bool _hasTargets;
        public override bool HasTargets { get { return _hasTargets; } }

        [Tooltip("The distance at which this Orientator starts to get a positive score.")]
        public float MaxDistance = 3000;
        public override float Priority
        {
            get
            {
                return (MaxDistance - _watchDistance) * PriorityMultiplier;
            }
        }

        private float _watchDistance;

        public float AngleProportion = 1.6f;

        public float MinimumDistance = 400;
        
        // Update is called once per frame
        void Update()
        {
            _hasTargets = _shipCam != null && _shipCam.FollowedTarget != null && _shipCam.TargetToWatch != null && _shipCam.FollowedTarget != _shipCam.TargetToWatch;
            if (_hasTargets)
            {
                _parentLocationTarget = (_shipCam.TargetToWatch.position + _shipCam.FollowedTarget.position) / 2;

                _referenceVelocity = (_shipCam.TargetToWatch.velocity + _shipCam.FollowedTarget.velocity) / 2;

                var vectorBetweenWatchedObjects = _shipCam.TargetToWatch.position - transform.position;

                _parentAndCameraOrientationTarget = Quaternion.LookRotation(
                        new Vector3(
                            vectorBetweenWatchedObjects.z,
                            vectorBetweenWatchedObjects.y,
                            vectorBetweenWatchedObjects.x
                        )
                    );

                _watchDistance = vectorBetweenWatchedObjects.magnitude;
                var setBack = Clamp(_watchDistance * 3, MinimumDistance, _watchDistance * 3);

                _cameraLocationTarget = _parentLocationTarget - transform.forward * setBack;

                var cameraToTargetVector = _shipCam.TargetToWatch.transform.position - _shipCam.Camera.transform.position;
                var cameraToFollowedVector = _shipCam.FollowedTarget.transform.position - _shipCam.Camera.transform.position;

                var baseAngle = Math.Max(
                    Vector3.Angle(_shipCam.Camera.transform.forward, cameraToTargetVector),
                    Vector3.Angle(_shipCam.Camera.transform.forward, cameraToFollowedVector)
                    );

                var desiredAngle = baseAngle * AngleProportion;
                _cameraFieldOfView = Clamp(desiredAngle, 1, 90);
            }
        }
    }
}