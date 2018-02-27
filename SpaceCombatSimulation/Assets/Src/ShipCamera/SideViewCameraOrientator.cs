using UnityEngine;
using System;
using System.Linq;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;

namespace Assets.Src.ShipCamera
{
    public class SideViewCameraOrientator : ManualCameraOrientator
    {
        private Vector3 _parentLocationTarget;
        public override Vector3 ParentLocationTarget { get { return _parentLocationTarget; } }

        private Vector3 _referenceVelocity;
        public override Vector3 ReferenceVelocity { get { return _referenceVelocity; } }

        private Vector3 _cameraLocationTarget;
        public override Vector3 CameraLocationTarget { get { return _cameraLocationTarget; } }
                
        public override Quaternion CameraOrientationTarget { get { return CameraLocationOrientation.rotation; } }
                
        public override Vector3 CameraPollTarget { get { return CameraLocationOrientation.forward; } }
                
        public override bool HasTargets { get { return _shipCam != null && _shipCam.FollowedTarget != null && _shipCam.TargetToWatch != null && _shipCam.FollowedTarget != _shipCam.TargetToWatch; } }

        [Tooltip("The distance at which this Orientator starts to get a positive score.")]
        public float MaxDistance = 2000;

        public override float Priority
        {
            get
            {
                return (MaxDistance - GetWatchDistance()) * PriorityMultiplier;
            }
        }

        public override string Description
        {
            get
            {
                return "SideView";
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

        public float AngleProportion = 1.8f;

        public float MinimumSetBackDistance = 400;
        public float MaximumSetBackDistance = 5000;

        public Transform CameraLocationOrientation;
        private float _lookAtDistanceProportion = 0.7f;

        private float GetWatchDistance()
        {
            return Vector3.Distance(_shipCam.FollowedTarget.position, _shipCam.TargetToWatch.position);
        }

        protected override ShipCamTargetValues CalculateAutomaticTargets()
        {
            if (HasTargets)
            {
                var targets = _shipCam.TargetsToWatch.ToList();
                targets.Add(_shipCam.FollowedTarget);
                targets = targets.Distinct().Where(t => t.transform.IsValid()).ToList();
                //Debug.Log("SideView: " + string.Join(",", targets.Select(t=>t.name).ToArray()));

                var minX = targets.Min(t => t.position.x);
                var minY = targets.Min(t => t.position.y);
                var minZ = targets.Min(t => t.position.z);

                var maxX = targets.Max(t => t.position.x);
                var maxY = targets.Max(t => t.position.y);
                var maxZ = targets.Max(t => t.position.z);

                _parentLocationTarget = new Vector3((maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2);

                var averageVX = targets.Average(t => t.velocity.x);
                var averageVY = targets.Average(t => t.velocity.y);
                var averageVZ = targets.Average(t => t.velocity.z);
                
                _referenceVelocity = new Vector3(averageVX, averageVY, averageVZ);
                
                _automaticParentPollTarget = PickPollTarget(_parentLocationTarget, targets);
                
                var setBack = Clamp(GetWatchDistance() * 3, MinimumSetBackDistance, MaximumSetBackDistance);

                //TODO stop using this transform because it works from the current orientation of the parent, not it's desired orientation.
                _cameraLocationTarget = CameraLocationOrientation.transform.position - CameraLocationOrientation.transform.forward * setBack;

                var vectorToParent = CameraLocationOrientation.transform.forward;
                var baseAngle = targets.Max(t => Vector3.Angle(vectorToParent, t.position - _cameraLocationTarget));

                var desiredAngle = baseAngle * AngleProportion;
                _automaticFieldOfView = Clamp(desiredAngle, 1, 90);
                return new ShipCamTargetValues(_parentLocationTarget, _automaticParentPollTarget, _cameraLocationTarget, CameraLocationOrientation.forward, _automaticFieldOfView, _referenceVelocity, _shipCam.FollowedTarget.transform.up);
            }
            return null;
        }

        private Vector3 PickPollTarget(Vector3 parentTargetLocation, List<Rigidbody> targets)
        {
            var vectors = targets.Select(t => t.position - parentTargetLocation);
            var maxDistance = vectors.Max(t => t.magnitude);
            var farEnough = vectors.Where(t => t.magnitude >= maxDistance * _lookAtDistanceProportion);
            return farEnough.OrderBy(t => Vector3.Angle(t, _shipCam.transform.forward)).First();
        }
    }
}