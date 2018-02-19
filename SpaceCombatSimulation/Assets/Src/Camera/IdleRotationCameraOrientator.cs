using UnityEngine;
using System;

namespace Assets.Src.Controllers
{
    public class IdleRotationCameraOrientator : BaseCameraOrientator
    {        
        private Vector3 _parentLocationTarget;
        public override Vector3 ParentLocationTarget { get { return _parentLocationTarget; } }

        private Vector3 _referenceVelocity;
        public override Vector3 ReferenceVelocity { get { return _referenceVelocity; } }

        public override Vector3 CameraLocationTarget { get { return _parentLocationTarget - (transform.forward * SetBack); } }

        private Quaternion _orientationTarget;
        public override Quaternion ParentOrientationTarget { get { return _orientationTarget; } }
        
        public override Quaternion CameraOrientationTarget { get { return _orientationTarget; } }

        private Vector3 _pollTarget;
        public override Vector3 ParentPollTarget { get { return _pollTarget; } }
        
        public override Vector3 CameraPollTarget { get { return _pollTarget; } }

        public override float CameraFieldOfView { get { return FieldOfView; } }
        
        public override bool HasTargets { get { return true; } }

        public override float Priority { get { return PriorityMultiplier; } }

        public float SetBack = 50;
        public float IdleRotationSpeed = -500;
        public float FieldOfView = 80;
        
        public override void CalculateTargets()
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
            _pollTarget = Quaternion.AngleAxis(Time.deltaTime * IdleRotationSpeed, transform.up) * transform.forward;
            _orientationTarget = transform.rotation * Quaternion.Euler(Time.deltaTime * IdleRotationSpeed * transform.up);
        }
    }
}