using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.ShipCamera
{
    public class ShipCamTargetValues
    {
        public Vector3 ParentLocationTarget { get; private set; }
        public Vector3 ParentPollTarget { get; private set; }
        public Quaternion ParentOrientationTarget { get; private set; }

        public Vector3 CameraLocationTarget { get; private set; }
        public Vector3 CameraPollTarget { get; private set; }
        public Quaternion CameraOrientationTarget { get; private set; }

        public Vector3 UpTarget { get; private set; }

        public float CameraFieldOfView { get; private set; }

        public Vector3 ReferenceVelocity { get; private set; }

        public ShipCamTargetValues(
            Vector3 parentLoc, Vector3 parentPole,
            Vector3 camLoc, Vector3 camPole,
            float camFov, Vector3 vRef,
            Vector3? up = null
            )
        {
            UpTarget = up ?? Vector3.up;

            ParentLocationTarget = parentLoc;
            ParentPollTarget = parentPole;
            ParentOrientationTarget = Quaternion.LookRotation(ParentPollTarget, UpTarget);

            CameraLocationTarget = camLoc;
            CameraPollTarget = camPole;
            CameraOrientationTarget = Quaternion.LookRotation(CameraPollTarget, UpTarget);

            CameraFieldOfView = camFov;

            ReferenceVelocity = vRef;
        }

        public ShipCamTargetValues(
           Vector3 parentLoc, Quaternion parentOrientation,
           Vector3 camLoc, Quaternion camOrientation,
           float camFov, Vector3 vRef
           )
        {
            ParentLocationTarget = parentLoc;
            ParentOrientationTarget = parentOrientation;
            ParentPollTarget = ParentOrientationTarget * Vector3.forward;

            UpTarget = ParentOrientationTarget * Vector3.up;

            CameraLocationTarget = camLoc;
            CameraOrientationTarget = camOrientation;
            CameraPollTarget = CameraOrientationTarget * Vector3.forward;

            CameraFieldOfView = camFov;

            ReferenceVelocity = vRef;
        }
        
        public ShipCamTargetValues AddTo ( ShipCamTargetValues b, float thisWeighting = 1, float bWeighting = 1 )
        {
            var parentLocationTarget = this.ParentLocationTarget * thisWeighting + b.ParentLocationTarget * bWeighting;
            var parentPollTarget = this.ParentPollTarget * thisWeighting + b.ParentPollTarget * bWeighting;

            var cameraLocationTarget = this.CameraLocationTarget * thisWeighting + b.CameraLocationTarget * bWeighting;
            var cameraPollTarget = this.CameraPollTarget * thisWeighting + b.CameraPollTarget * bWeighting;

            var upTarget = this.UpTarget * thisWeighting + b.UpTarget * bWeighting;

            var cameraFieldOfView = this.CameraFieldOfView * thisWeighting + b.CameraFieldOfView * bWeighting;

            var referenceVelocity = this.ReferenceVelocity * thisWeighting + b.ReferenceVelocity * bWeighting;

            return new ShipCamTargetValues(parentLocationTarget, parentPollTarget, cameraLocationTarget, cameraPollTarget, cameraFieldOfView, referenceVelocity, upTarget);
        }

        public ShipCamTargetValues DivideBy(float denominator)
        {
            var parentLocationTarget = this.ParentLocationTarget / denominator;
            var parentPollTarget = this.ParentPollTarget / denominator;

            var cameraLocationTarget = this.CameraLocationTarget / denominator;
            var cameraPollTarget = this.CameraPollTarget / denominator;

            var upTarget = this.UpTarget / denominator;

            var cameraFieldOfView = this.CameraFieldOfView / denominator;

            var referenceVelocity = this.ReferenceVelocity / denominator;

            return new ShipCamTargetValues(parentLocationTarget, parentPollTarget, cameraLocationTarget, cameraPollTarget, cameraFieldOfView, referenceVelocity, upTarget);
        }

        public ShipCamTargetValues MultiplyBy(float multiplier)
        {
            var parentLocationTarget = this.ParentLocationTarget * multiplier;
            var parentPollTarget = this.ParentPollTarget * multiplier;

            var cameraLocationTarget = this.CameraLocationTarget * multiplier;
            var cameraPollTarget = this.CameraPollTarget * multiplier;

            var upTarget = this.UpTarget * multiplier;

            var cameraFieldOfView = this.CameraFieldOfView * multiplier;

            var referenceVelocity = this.ReferenceVelocity * multiplier;

            return new ShipCamTargetValues(parentLocationTarget, parentPollTarget, cameraLocationTarget, cameraPollTarget, cameraFieldOfView, referenceVelocity, upTarget);
        }

        public static ShipCamTargetValues Zero {
            get {
                return new ShipCamTargetValues(Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero, 0, Vector3.zero, Vector3.zero);
                }
        }
    }
}
