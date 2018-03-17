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
        public int MouseButtonIndex = 1;

        private float _manualPanTimeRemaining = 0;
        protected bool ManualPanMode
        {
            get
            {
                return _manualPanTimeRemaining > 0;
            }
        }


        private float _manualZoomTimeRemaining = 0;
        protected bool ManualZoomMode
        {
            get
            {
                return _manualZoomTimeRemaining > 0;
            }
        }

        protected abstract ShipCamTargetValues CalculateAutomaticTargets();

        public sealed override ShipCamTargetValues CalculateTargets()
        {
            var targets = CalculateAutomaticTargets();
            ProcessManualPanning(targets);
            ProcessManualZoom(targets);
            
            //ToDo Stop this using its public properties. (maybe just make them private)
            return new ShipCamTargetValues(targets.ParentLocationTarget, GetParentPollTarget(targets), targets.CameraLocationTarget, targets.CameraPollTarget, targets.CameraFieldOfView, targets.ReferenceVelocity, targets.UpTarget);
        }

        private void ProcessManualPanning(ShipCamTargetValues targets)
        {
            //if (Input.GetMouseButtonDown(MouseButtonIndex))
            //{
            //    //set these before they will be affected buy setting the _manualTimeRemaining up.
            //    _ManualParentPollTarget = GetParentPollTarget(targets);
            //    _manualPanTimeRemaining = ManualTime;
            //}

            if (Input.GetMouseButton(MouseButtonIndex))
            {
                if (!ManualPanMode)
                {
                    //set these before they will be affected buy setting the _manualTimeRemaining up.
                    _ManualParentPollTarget = GetParentPollTarget(targets);
                    _manualPanTimeRemaining = ManualTime;
                }
                var vertical = Input.GetAxis("Mouse Y");
                var horizontal = Input.GetAxis("Mouse X");
                //Debug.Log("vertical: " + vertical);
                //Debug.Log("horizontal: " + horizontal);

                _ManualParentPollTarget = Quaternion.AngleAxis(-RotationSpeed * vertical, _shipCam.Camera.transform.right) * transform.forward;
                _ManualParentPollTarget = Quaternion.AngleAxis(RotationSpeed * horizontal, _shipCam.Camera.transform.up) * _ManualParentPollTarget;
                //Debug.Log(_pollTarget);
                return;
            }
            _manualPanTimeRemaining -= Time.deltaTime;
        }

        private void ProcessManualZoom(ShipCamTargetValues targets)
        {
            var scroll = Input.GetAxis("Mouse ScrollWheel");
            Debug.Log(scroll);

            if (scroll != 0)
            {
                //_manualFieldOfView = _shipCam.Camera.fieldOfView + scroll * 100;
                _manualFieldOfView = _manualFieldOfView + scroll;

                _manualZoomTimeRemaining = ManualTime;

                return;
            }
            _manualZoomTimeRemaining -= Time.deltaTime;
        }

        private Vector3 GetParentPollTarget(ShipCamTargetValues automaticTargets)
        {
            return ManualPanMode ? _ManualParentPollTarget : automaticTargets.ParentPollTarget;
        }

        private float GetCameraFieldOfView(ShipCamTargetValues automaticTargets)
        {
            return ManualZoomMode ? _manualFieldOfView : automaticTargets.CameraFieldOfView;
        }
    }
}