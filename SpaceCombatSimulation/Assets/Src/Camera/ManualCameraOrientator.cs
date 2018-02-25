using UnityEngine;
using System;

namespace Assets.Src.Controllers
{
    public abstract class ManualCameraOrientator : BaseCameraOrientator
    {
        public sealed override Quaternion ParentOrientationTarget { get { return Quaternion.LookRotation(ParentPollTarget); } }

        protected abstract Vector3 AutomaticParentPollTarget {get;}
        private Vector3 _ManualParentPollTarget;
        public sealed override Vector3 ParentPollTarget { get { return ManualMode ? _ManualParentPollTarget : AutomaticParentPollTarget; } }

        protected abstract float AutomaticFieldOfView { get; }
        public sealed override float CameraFieldOfView { get { return ManualMode ? _manualFieldOfView : AutomaticFieldOfView; } }
        
        private float _manualFieldOfView = 80;

        private bool _mouseIsDown = false;
        public float RotationSpeed = 10;

        [Tooltip("The time this camera mode stays at the manual orientation after the user releases teh button.")]
        public float ManualTime = 20;
        private float _manualTimeRemaining = 0;
        public int MouseButtonIndex = 1;

        protected bool ManualMode
        {
            get
            {
                return _manualTimeRemaining > 0;
            }
        }

        protected abstract void CalculateAutomaticTargets();

        public sealed override void CalculateTargets()
        {
            if (Input.GetMouseButtonDown(MouseButtonIndex))
            {
                _mouseIsDown = true;

                //set these before they will be affected buy setting the _manualTimeRemaining up.
                _ManualParentPollTarget = ParentPollTarget;
                _manualFieldOfView = CameraFieldOfView;

                _manualTimeRemaining = ManualTime;
            }
            if (Input.GetMouseButtonUp(MouseButtonIndex))
            {
                _mouseIsDown = false;
            }

            if (_mouseIsDown)
            {
                var vertical = Input.GetAxis("Mouse Y");
                var horizontal = Input.GetAxis("Mouse X");
                //Debug.Log("vertical: " + vertical);
                //Debug.Log("horizontal: " + horizontal);
                
                _ManualParentPollTarget = Quaternion.AngleAxis(-RotationSpeed * vertical, _shipCam.Camera.transform.right) * transform.forward;
                _ManualParentPollTarget = Quaternion.AngleAxis(RotationSpeed * horizontal, _shipCam.Camera.transform.up) * _ManualParentPollTarget;
                //Debug.Log(_pollTarget);
            } else
            {
                _manualTimeRemaining -= Time.deltaTime;
            }
            CalculateAutomaticTargets();
            //Debug.Log("mouse is down: " + _mouseIsDown);
        }
    }
}