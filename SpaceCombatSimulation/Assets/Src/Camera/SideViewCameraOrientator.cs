using UnityEngine;
using System;
using System.Linq;
using Assets.Src.ObjectManagement;

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
                var targets = _shipCam.TargetsToWatch.ToList();
                targets.Add(_shipCam.FollowedTarget);
                targets = targets.Distinct().Where(t => t.transform.IsValid()).ToList();
                //Debug.Log("SideView: " + string.Join(",", targets.Select(t=>t.name).ToArray()));

                var averageX = targets.Average(t => t.position.x);
                var averageY = targets.Average(t => t.position.y);
                var averageZ = targets.Average(t => t.position.z);

                _parentLocationTarget = new Vector3(averageX, averageY, averageZ);
                
                var averageVX = targets.Average(t => t.velocity.x);
                var averageVY = targets.Average(t => t.velocity.y);
                var averageVZ = targets.Average(t => t.velocity.z);

                _referenceVelocity = new Vector3(averageVX, averageVY, averageVZ);
                
                var vectorBetweenWatchedObjects = _shipCam.TargetToWatch.position - _shipCam.FollowedTarget.position;

                _parentOrientationTarget = Quaternion.LookRotation(vectorBetweenWatchedObjects);
                
                _watchDistance = vectorBetweenWatchedObjects.magnitude;
                var setBack = Clamp(_watchDistance * 3, MinimumDistance, _watchDistance * 3);

                _cameraLocationTarget = CameraLocationOrientation.transform.position - CameraLocationOrientation.transform.forward * setBack;
                
                var vectorToParent = CameraLocationOrientation.transform.forward;
                var baseAngle = targets.Max(t => Vector3.Angle(vectorToParent, t.position - _cameraLocationTarget));

                var desiredAngle = baseAngle * AngleProportion;
                _cameraFieldOfView = Clamp(desiredAngle, 1, 90);
            }
        }
    }
}