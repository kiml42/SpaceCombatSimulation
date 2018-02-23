using UnityEngine;
using System;

namespace Assets.Src.Controllers
{
    public class ManualCameraOrientator : BaseCameraOrientator
    {        
        public override Vector3 ParentLocationTarget { get { return _shipCam.FollowedTarget.position; } }

        private Vector3 _referenceVelocity;
        public override Vector3 ReferenceVelocity { get { return _shipCam.FollowedTarget.velocity; } }

        public Transform DefaultCamLocation;
        private Vector3 _cameraLocationTarget;
        public override Vector3 CameraLocationTarget { get { return _cameraLocationTarget; } }

        public override Quaternion ParentOrientationTarget { get { return Quaternion.LookRotation(_pollTarget); } }
        
        public override Quaternion CameraOrientationTarget { get { return Quaternion.LookRotation(_pollTarget); } }

        private Vector3 _pollTarget;
        public override Vector3 ParentPollTarget { get { return _pollTarget; } }
        
        public override Vector3 CameraPollTarget { get { return _pollTarget; } }

        public override float CameraFieldOfView { get { return FieldOfView; } }
        
        public override bool HasTargets { get { return true; } }
        
        public override float Priority {
            get {
                var mouseDown = Input.GetMouseButtonDown(0);
                if (mouseDown)
                {

                }
                //Debug.Log("mouse down: " + mouseDown);

                _mouseIsDown = _mouseIsDown || mouseDown;

                _priority = _mouseIsDown ? ManualPriority : _priority;

                return _priority * PriorityMultiplier;
            }
        }

        public override string Description
        {
            get
            {
                return "IdleRotation";
            }
        }

        public float SetBack = 50;
        public float FieldOfView = 80;

        private bool _mouseIsDown = false;
        private float _priority;
        public float PriorityDecay = 50;
        public float ManualPriority = 5000;
        public float RotationSpeed = 10;

        public override void CalculateTargets()
        {
            var mouseUp = Input.GetMouseButtonUp(0);

            if (mouseUp)
            {
                _mouseIsDown = false;
            }
            
            _cameraLocationTarget = DefaultCamLocation.position + (DefaultCamLocation.forward * -SetBack);

            if (_mouseIsDown)
            {
                var vertical = Input.GetAxis("Mouse Y");
                var horizontal = Input.GetAxis("Mouse X");
                //Debug.Log("vertical: " + vertical);
                //Debug.Log("horizontal: " + horizontal);


                _pollTarget = Quaternion.AngleAxis(-RotationSpeed * vertical, transform.right) * transform.forward;
                _pollTarget = Quaternion.AngleAxis(RotationSpeed * horizontal, transform.up) * _pollTarget;
                //Debug.Log(_pollTarget);

            } else
            {
                _pollTarget = transform.forward;
                _priority -= PriorityDecay * Time.deltaTime;
            }


            //Debug.Log("mouse is down: " + _mouseIsDown);
        }
    }
}