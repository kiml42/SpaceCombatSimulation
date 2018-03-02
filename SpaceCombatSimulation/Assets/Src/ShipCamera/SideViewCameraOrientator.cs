using UnityEngine;
using System;
using System.Linq;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;

namespace Assets.Src.ShipCamera
{
    public class SideViewCameraOrientator : ManualCameraOrientator
    {
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

                var parentLocationTarget = new Vector3((maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2);

                var averageVX = targets.Average(t => t.velocity.x);
                var averageVY = targets.Average(t => t.velocity.y);
                var averageVZ = targets.Average(t => t.velocity.z);
                
                var referenceVelocity = new Vector3(averageVX, averageVY, averageVZ);
                
                var automaticParentPollTarget = PickPollTarget(parentLocationTarget, targets);
                
                var setBack = Clamp(GetWatchDistance() * 3, MinimumSetBackDistance, MaximumSetBackDistance);

                //TODO stop using this transform because it works from the current orientation of the parent, not it's desired orientation.
                var cameraLocationTarget = CameraLocationOrientation.transform.position - CameraLocationOrientation.transform.forward * setBack;

                var vectorToParent = CameraLocationOrientation.transform.forward;
                var baseAngle = targets.Max(t => Vector3.Angle(vectorToParent, t.position - cameraLocationTarget));

                var desiredAngle = baseAngle * AngleProportion;
                var automaticFieldOfView = Clamp(desiredAngle, 1, 90);

                return new ShipCamTargetValues(parentLocationTarget, automaticParentPollTarget, cameraLocationTarget, CameraLocationOrientation.forward, automaticFieldOfView, referenceVelocity, UpVector);
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