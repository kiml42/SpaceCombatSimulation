using UnityEngine;
using System;
using System.Linq;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;

namespace Assets.Src.ShipCamera
{
    public class SideViewCameraOrientator : ManualCameraOrientator
    {
        public override bool HasTargets { get { return _shipCam != null && _shipCam.FollowedTarget != null && _shipCam.WatchedRigidbody != null && _shipCam.FollowedTarget != _shipCam.WatchedRigidbody; } }

        [Tooltip("The distance at which this Orientator starts to get a positive score.")]
        public float ZeroScoreDistance = 2000;

        public override float Priority
        {
            get
            {
                return (ZeroScoreDistance - _watchDistance) * PriorityMultiplier;
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

        private float _watchDistance
        {
            get
            {
                return Vector3.Distance(_shipCam.FollowedTarget.position, _shipCam.WatchedRigidbody.position);
            }
        }

        [Tooltip("Only target within this distance will be considered. unless hthere aren't any in this distance")]
        public float TargetFilterDistance = 2000;

        [Tooltip("Extra distance around the edges of the volume contained by the targets centres to include in the camera's field of view.")]
        public float AssumedTargetRadius = 15;

        [Tooltip("Angle between the furthest out watched point and the edge of the field of view.")]
        public float ExtraAngle = 10;

        private List<Rigidbody> _filteredTargets
        {
            get
            {
                var targets = _shipCam.WatchedRigidbodies.Where(t => t != null && t.transform.IsValid()).ToList();

                var closeTargets = targets.Where(t => Vector3.Distance(t.position,_shipCam.FollowedTarget.position) < TargetFilterDistance).ToList();

                //Debug.Log("Close targets count = " + closeTargets.Count());
                targets = closeTargets.Any(t => t != _shipCam.FollowedTarget) ? closeTargets : targets;

                //make sure these two are included
                targets.Add(_shipCam.FollowedTarget);
                targets.Add(_shipCam.WatchedRigidbody);

                return targets.Distinct().Where(t => t.transform.IsValid()).ToList();
            }
        }

        private ShipCamTargetValues _previousTargets = ShipCamTargetValues.Zero;

        protected override ShipCamTargetValues CalculateAutomaticTargets()
        {
            if (HasTargets)
            {
                var targets = _filteredTargets;
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
                
                var setBack = Clamp(_watchDistance * 3, MinimumSetBackDistance, MaximumSetBackDistance);

                //TODO stop using this transform because it works from the current orientation of the parent, not it's desired orientation.
                var cameraLocationTarget = CameraLocationOrientation.transform.position - CameraLocationOrientation.transform.forward * setBack;

                var vectorToParent = CameraLocationOrientation.transform.forward;

                var baseAngle = targets.Select(t =>
                {
                    var vectorToCamera = t.position - cameraLocationTarget;
                    var angle = Vector3.Angle(vectorToParent, vectorToCamera);
                    var extraAngleForTargetSize = (float)Math.Atan(AssumedTargetRadius / vectorToCamera.magnitude);
                    return angle + extraAngleForTargetSize;
                }).Max();

                var desiredAngle = baseAngle * AngleProportion + ExtraAngle;

                var fieldOfView = Clamp(desiredAngle, 1, 90);
                
                _previousTargets = new ShipCamTargetValues(parentLocationTarget, automaticParentPollTarget, cameraLocationTarget, CameraLocationOrientation.forward, fieldOfView, referenceVelocity, UpVector);
            }
            return _previousTargets;
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