using UnityEngine;
using System;

namespace Assets.Src.ShipCamera
{
    public class IdleRotationCameraOrientator : ManualCameraOrientator
    {        
        private Vector3 _parentLocationTarget;
        public override Vector3 ParentLocationTarget { get { return _parentLocationTarget; } }

        private Vector3 _referenceVelocity;
        public override Vector3 ReferenceVelocity { get { return _referenceVelocity; } }

        public override Vector3 CameraLocationTarget { get { return _parentLocationTarget - (transform.forward * SetBack); } }
     
        public override Quaternion CameraOrientationTarget { get { return Quaternion.LookRotation(ParentPollTarget); } }
        
        public override Vector3 CameraPollTarget { get { return ParentPollTarget; } }
        
        public override bool HasTargets { get { return true; } }

        public override float Priority { get { return PriorityMultiplier; } }

        public override string Description
        {
            get
            {
                return "IdleRotation";
            }
        }

        public float SetBack = 50;
        public float IdleRotationSpeed = -500;

        public float FieldOfView = 80;
        private Vector3 _automaticParentPollTarget;
        protected override Vector3 AutomaticParentPollTarget
        {
            get
            {
                return _automaticParentPollTarget;
            }
        }
        
        protected override float AutomaticFieldOfView
        {
            get
            {
                return FieldOfView;
            }
        }
        
        protected override ShipCamTargetValues CalculateAutomaticTargets()
        {
            Rigidbody target = null;
            if (_shipCam != null && (_shipCam.FollowedTarget != null || _shipCam.TargetToWatch != null))
                target = _shipCam.FollowedTarget ?? _shipCam.TargetToWatch;
            if (target != null)
            {
                _parentLocationTarget = target.position;
                _referenceVelocity = target.velocity;
            }
            else
            {
                _parentLocationTarget = Vector3.zero;
                _referenceVelocity = Vector3.zero;
            }
            _automaticParentPollTarget = Quaternion.AngleAxis(Time.deltaTime * IdleRotationSpeed, transform.up) * transform.forward;

            return new ShipCamTargetValues(_parentLocationTarget, _automaticParentPollTarget, _parentLocationTarget - (transform.forward * SetBack), ParentPollTarget, FieldOfView, _referenceVelocity, _shipCam.FollowedTarget.transform.up);
        }
    }
}