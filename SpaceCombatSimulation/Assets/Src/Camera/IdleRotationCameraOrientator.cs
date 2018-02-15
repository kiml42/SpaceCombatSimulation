using UnityEngine;
using System;

namespace Assets.Src.Controllers
{
    public class IdleRotationCameraOrientator : BaseCameraOrientator
    {        
        private Vector3 _parentLocationTarget;
        public override Vector3 ParentLocationTarget { get { return _parentLocationTarget; } }
        
        public override Vector3 CameraLocationTarget { get { return _parentLocationTarget - (transform.forward * SetBack); } }

        private Quaternion _parentAndCameraOrientationTarget;
        public override Quaternion ParentOrientationTarget { get { return _parentAndCameraOrientationTarget; } }
        
        public override Quaternion CameraOrientationTarget { get { return _parentAndCameraOrientationTarget; } }
        
        public override float CameraFieldOfView { get { return FieldOfView; } }
        
        public override bool HasTargets { get { return true; } }

        public override float Priority { get { return PriorityMultiplier; } }

        public float SetBack = 50;
        public float IdleRotationSpeed = -1500;
        public float FieldOfView = 80;

        // Update is called once per frame
        void Update()
        {
            Rigidbody target = null;
            if(_shipCam != null && (_shipCam.FollowedTarget != null || _shipCam.TargetToWatch != null))
                target = _shipCam.FollowedTarget ?? _shipCam.TargetToWatch;
            _parentLocationTarget = target != null ? target.position : Vector3.zero;
            _parentAndCameraOrientationTarget = transform.rotation * Quaternion.Euler(Time.deltaTime * IdleRotationSpeed * transform.up);
        }
    }
}