using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public abstract class ManualCameraOrientator : BaseCameraOrientator
    {
        private Vector3 _manualParentPollTarget;
        private Vector3 _manualUpTarget;
        private float _manualCameraLocOffset;
        
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

        [Tooltip("multiplier for moving the camera forwards or backwards when zooming")]
        public float ZoomSpeed = 10;

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

            targets = targets ?? ShipCamTargetValues.Zero;

            return new ShipCamTargetValues(targets.ParentLocationTarget, GetParentPollTarget(targets), GetCameraLocationTarget(targets), targets.CameraPollTarget, targets.CameraFieldOfView, targets.ReferenceVelocity, GetUpTarget(targets));
        }

        private void ProcessManualPanning(ShipCamTargetValues targets)
        {
            if (Input.GetMouseButton(MouseButtonIndex))
            {
                if (!ManualPanMode)
                {
                    //set these before they will be affected buy setting the _manualTimeRemaining up.
                    _manualParentPollTarget = GetParentPollTarget(targets);
                    _manualPanTimeRemaining = ManualTime;
                    _manualUpTarget = targets.UpTarget;
                }
                var vertical = Input.GetAxis("Mouse Y");
                var horizontal = Input.GetAxis("Mouse X");
                //Debug.Log("vertical: " + vertical);
                //Debug.Log("horizontal: " + horizontal);

                _manualParentPollTarget = Quaternion.AngleAxis(-RotationSpeed * vertical, _shipCam.Camera.transform.right) * transform.forward;
                _manualParentPollTarget = Quaternion.AngleAxis(RotationSpeed * horizontal, _shipCam.Camera.transform.up) * _manualParentPollTarget;

                _manualUpTarget = Quaternion.AngleAxis(-RotationSpeed * vertical, _shipCam.Camera.transform.right) * transform.up;
                _manualUpTarget = Quaternion.AngleAxis(RotationSpeed * horizontal, _shipCam.Camera.transform.up) * _manualUpTarget;
                //Debug.Log(_pollTarget);
                return;
            }
            _manualPanTimeRemaining -= Time.deltaTime;
        }

        private void ProcessManualZoom(ShipCamTargetValues targets)
        {
            var scroll = Input.GetAxis("Mouse ScrollWheel");

            if (scroll != 0)
            {
                if (!ManualZoomMode)
                {
                    _manualCameraLocOffset = 0;
                }
                //_manualFieldOfView = _shipCam.Camera.fieldOfView + scroll * 100;
                _manualCameraLocOffset = _manualCameraLocOffset + (scroll * ZoomSpeed);
                //Debug.Log(" _manualCameraLocOffset: " + _manualCameraLocOffset + " scroll: " + scroll);

                _manualZoomTimeRemaining = ManualTime;

                return;
            }
            _manualZoomTimeRemaining -= Time.deltaTime;
        }

        private Vector3 GetParentPollTarget(ShipCamTargetValues automaticTargets)
        {
            return ManualPanMode ? _manualParentPollTarget : automaticTargets.ParentPollTarget;
        }

        private Vector3 GetUpTarget(ShipCamTargetValues automaticTargets)
        {
            return ManualPanMode ? _manualUpTarget : automaticTargets.UpTarget;
        }

        private Vector3 GetCameraLocationTarget(ShipCamTargetValues automaticTargets)
        {
            var setbackDistance = ManualZoomMode ? _manualCameraLocOffset : 0;
            var offset = automaticTargets.CameraPollTarget * setbackDistance;

            return automaticTargets.CameraLocationTarget + offset;
        }
    }
}