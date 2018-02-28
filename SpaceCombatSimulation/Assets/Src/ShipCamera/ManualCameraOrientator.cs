using UnityEngine;
using System;

namespace Assets.Src.ShipCamera
{
    public abstract class ManualCameraOrientator : BaseCameraOrientator
    {
        private Vector3 _ManualParentPollTarget;
        private float _manualFieldOfView = 80;
        
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

        protected abstract ShipCamTargetValues CalculateAutomaticTargets();

        public sealed override ShipCamTargetValues CalculateTargets()
        {
            var targets = CalculateAutomaticTargets();

            if (Input.GetMouseButtonDown(MouseButtonIndex))
            {
                //set these before they will be affected buy setting the _manualTimeRemaining up.
                _ManualParentPollTarget = GetParentPollTarget(targets);
                _manualFieldOfView = GetCameraFieldOfView(targets);

                _manualTimeRemaining = ManualTime;
            }

            if (Input.GetMouseButton(MouseButtonIndex))
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
            //Debug.Log("mouse is down: " + _mouseIsDown);

            //ToDo Stop this using its public properties. (maybe just make them private)
            return new ShipCamTargetValues(targets.ParentLocationTarget, GetParentPollTarget(targets), targets.CameraLocationTarget, targets.CameraPollTarget, targets.CameraFieldOfView, targets.ReferenceVelocity, targets.UpTarget);
        }

        private Vector3 GetParentPollTarget(ShipCamTargetValues automaticTargets)
        {
            return ManualMode ? _ManualParentPollTarget : automaticTargets.ParentPollTarget;
        }

        private float GetCameraFieldOfView(ShipCamTargetValues automaticTargets)
        {
            return ManualMode ? _manualFieldOfView : automaticTargets.CameraFieldOfView;
        }
    }
}